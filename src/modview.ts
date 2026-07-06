import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function getModelFileExtensions(): string[] {
    const raw = vscode.workspace
        .getConfiguration('nmbench')
        .get<string[]>('browser.fileExtensions', ['mod', 'ctl']);
    return raw
        .map(e => e.replace(/^\./, '').trim().toLowerCase())
        .filter(Boolean);
}

export function getModelFileRegex(): RegExp {
    const exts = getModelFileExtensions();
    if (exts.length === 0) { return /$^/; }
    const alt = exts.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(`\\.(${alt})$`, 'i');
}

export class NmbenchDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;
    private readonly _map = new Map<string, vscode.FileDecoration>();

    update(uri: vscode.Uri, decoration: vscode.FileDecoration | undefined): void {
        if (decoration) {
            this._map.set(uri.fsPath, decoration);
        } else {
            this._map.delete(uri.fsPath);
        }
        this._onDidChange.fire(uri);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        return this._map.get(uri.fsPath);
    }
}

export const nmbenchDecorationProvider = new NmbenchDecorationProvider();

function getBadgeColor(statusText: string): vscode.ThemeColor {
    switch (statusText) {
        case 'Minimization Successful':  return new vscode.ThemeColor('charts.green');
        case 'Minimization Terminated':  return new vscode.ThemeColor('charts.red');
        case 'Simulation':               return new vscode.ThemeColor('charts.blue');
        case 'w Rounding Error':         return new vscode.ThemeColor('charts.yellow');
        case 'w Boundary Error':         return new vscode.ThemeColor('charts.blue');
        case 'w Matrix Error':           return new vscode.ThemeColor('charts.red');
        default:                         return new vscode.ThemeColor('charts.green');
    }
}

function getStatusIconMarkdown(statusText: string): string {
    switch (statusText) {
        case 'Minimization Successful':  return '$(pass) ';
        case 'Minimization Terminated':  return '$(error) ';
        case 'Simulation':               return '$(beaker) ';
        case 'w Rounding Error':         return '$(warning) ';
        case 'w Boundary Error':         return '$(warning) ';
        case 'w Matrix Error':           return '$(error) ';
        case 'w Covariance Step done':   return '$(check) ';
        default:                         return '$(circle-outline) ';
    }
}

export class ModFileViewerProvider implements vscode.TreeDataProvider<ModFile | ModFolder> {
    private _onDidChangeTreeData: vscode.EventEmitter<ModFile | ModFolder | undefined> = new vscode.EventEmitter<ModFile | ModFolder | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ModFile | ModFolder | undefined> = this._onDidChangeTreeData.event;

    constructor(
        private readonly activeRunningTerminals: Set<vscode.Terminal>,
        private readonly shellIntegrationSeenTerminals: Set<vscode.Terminal>
    ) {}

    refresh(element?: ModFile | ModFolder): void {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: ModFile | ModFolder): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ModFile | ModFolder): Promise<(ModFile | ModFolder)[]> {
        if (!element) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) { return []; }
            return workspaceFolders.map(folder => new ModFolder(folder.uri));
        } else if (element instanceof ModFolder) {
            try {
                const files = await fs.promises.readdir(element.uri.fsPath);
                const folders: ModFolder[] = [];
                const modFiles: ModFile[] = [];
                const modRegex = getModelFileRegex();

                for (const file of files) {
                    const filePath = path.join(element.uri.fsPath, file);
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isDirectory()) {
                        folders.push(new ModFolder(vscode.Uri.file(filePath)));
                    } else if (modRegex.test(file)) {
                        const modFile = new ModFile(vscode.Uri.file(filePath));
                        await modFile.initialize();
                        await modFile.checkTerminal(this.activeRunningTerminals, this.shellIntegrationSeenTerminals);
                        modFiles.push(modFile);
                    }
                }
                // Toggle-based hiding of folders whose name includes 'modelfit_dir' (case-insensitive)
                const hide = vscode.workspace
                    .getConfiguration('nmbench')
                    .get<boolean>('modFileViewer.hideModelFitDirs', false);
                const filteredFolders = hide
                    ? folders.filter(f =>
                        !path.basename(f.uri.fsPath).toLowerCase().includes('modelfit_dir')
                      )
                    : folders;
                return [...filteredFolders, ...modFiles];
            } catch (err) {
                console.error('Failed to read directory:', err);
                return [];
            }
        } else {
            return [];
        }
    }

    async getModFileOrFolder(uri: vscode.Uri): Promise<ModFile | ModFolder | undefined> {
        const currentDir = path.dirname(uri.fsPath);
        const files = await fs.promises.readdir(currentDir);
        const modRegex = getModelFileRegex();
        const children = await Promise.all(files.map(async file => {
            const filePath = path.join(currentDir, file);
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
                return new ModFolder(vscode.Uri.file(filePath));
            } else if (modRegex.test(file)) {
                const modFile = new ModFile(vscode.Uri.file(filePath));
                await modFile.initialize();
                await modFile.checkTerminal(this.activeRunningTerminals, this.shellIntegrationSeenTerminals);
                return modFile;
            }
        }));
        return children.find(child => child?.uri.fsPath === uri.fsPath);
    }

    getParent(element: ModFile | ModFolder): vscode.ProviderResult<ModFile | ModFolder> {
        const parentUri = path.dirname(element.uri.fsPath);
        if (parentUri === element.uri.fsPath) { return null; }
        return new ModFolder(vscode.Uri.file(parentUri));
    }
}

export class ModFile extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath));
        this.id = uri.fsPath;
        // Intentionally do NOT set `resourceUri` — that would make VS Code automatically overlay
        // FileDecorationProvider badges (both nmbench's own S/T/... badge and the built-in git
        // status badge) onto tree items. In the NMBENCH: BROWSER view we now show the full status
        // list in `description`, so the corner badge is redundant here. The badge still shows up
        // in the built-in Explorer where the file URI is rendered directly.
        this.contextValue = 'modFile';
        this.iconPath = new vscode.ThemeIcon('file');
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.uri]
        };
    }

    async initialize(): Promise<void> {
        const statuses = await this.getStatuses();
        const tooltipMd = new vscode.MarkdownString(
            statuses.map(s => `${getStatusIconMarkdown(s.text)}${s.text}`).join('\n\n')
        );
        tooltipMd.supportThemeIcons = true;
        this.tooltip = tooltipMd;
        const objectiveFunctionValue = await this.getObjectiveFunctionValue();
        // Show every status code (primary + secondary) in the description so users can read the full
        // status text after the filename without relying on the icon color or the corner badge.
        const codesPart = statuses.length > 0 ? `[${statuses.map(s => s.code).join(', ')}] ` : '';
        this.description = objectiveFunctionValue ? `${codesPart}${objectiveFunctionValue}` : codesPart.trimEnd();

        if (statuses.length > 0) {
            this.iconPath = this.getStatusIconPath(statuses);
            const primaryChar = statuses[0].code === 'SIM' ? 'SI' : statuses[0].code.slice(0, 1);
            const badge = statuses.length > 1 ? statuses[0].code.slice(0, 1) + '+' : primaryChar;
            const tooltip = statuses.map(s => s.text).join('\n');
            const codes = new Set(statuses.map(s => s.code));
            const warnCombination = statuses[0].code === 'S' && (codes.has('M') || codes.has('B') || codes.has('R'));
            const badgeColor = warnCombination
                ? new vscode.ThemeColor('charts.yellow')
                : getBadgeColor(statuses[0].text);
            nmbenchDecorationProvider.update(this.uri, new vscode.FileDecoration(badge, tooltip, badgeColor));
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
            nmbenchDecorationProvider.update(this.uri, undefined);
        }
    }

    private async getStatuses(): Promise<{ text: string, code: string }[]> {
        const lstFilePath = this.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        let content: string;
        try {
            content = await fs.promises.readFile(lstFilePath, 'utf-8');
        } catch {
            return [];
        }

        const statuses: { text: string, code: string }[] = [];
        if (content.includes('MINIMIZATION SUCCESSFUL') || content.includes('REDUCED STOCHASTIC PORTION WAS COMPLETED')) {
            statuses.push({ text: 'Minimization Successful', code: 'S' });
        }
        if (content.includes('MINIMIZATION TERMINATED') || content.includes('REDUCED STOCHASTIC PORTION WAS NOT COMPLETED')) {
            statuses.push({ text: 'Minimization Terminated', code: 'T' });
        }
        if (content.includes('SIMULATION STEP PERFORMED')) {
            statuses.push({ text: 'Simulation', code: 'SIM' });
        }
        if (content.includes('DUE TO ROUNDING ERRORS')) {
            statuses.push({ text: 'w Rounding Error', code: 'R' });
        }
        if (content.includes('PARAMETER ESTIMATE IS NEAR ITS BOUNDARY')) {
            statuses.push({ text: 'w Boundary Error', code: 'B' });
        }
        const matrixSingular = content.includes('MATRIX ALGORITHMICALLY');
        const covOmitted = /COVARIANCE STEP OMITTED:\s*YES/i.test(content);
        const covNotSuccessful = /COVARIANCE STEP NOT SUCCESSFUL/i.test(content);
        const covSuccess = /COVARIANCE STEP SUCCESSFUL|COVARIANCE STEP COMPLETED/i.test(content);
        const covWarning = /COVARIANCE STEP WARNING|COVARIANCE STEP WITH WARNING/i.test(content);
        const covMatrixSeen = /COVARIANCE MATRIX OF ESTIMATE(?!.*INVERSE)/i.test(content);
        const covElapsed = /Elapsed\s*covariance\s*time\s*in\s*seconds:/i.test(content);
        const covSubstituted = /[RS] MATRIX SUBSTITUTED:\s*YES/i.test(content);
        const covStepOkOrWarning = !covOmitted && covMatrixSeen && (
            covSuccess ||
            covWarning ||
            covElapsed ||
            (covSubstituted && covMatrixSeen) ||
            (covNotSuccessful && covSubstituted && covMatrixSeen)
        );

        if (matrixSingular) {
            statuses.push({ text: 'w Matrix Error', code: 'M' });
        } else if (covStepOkOrWarning) {
            statuses.push({ text: 'w Covariance Step done', code: 'C' });
        }

        return statuses;
    }

    private getStatusIconPath(statuses: { text: string, code: string }[]): vscode.ThemeIcon {
        const primary = statuses[0].text;
        const codes = new Set(statuses.map(s => s.code));
        switch (primary) {
            case 'Minimization Successful':
                if (codes.has('M') || codes.has('B') || codes.has('R')) {
                    return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.yellow'));
                }
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'));
            case 'Minimization Terminated':
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.red'));
            case 'Simulation':
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.blue'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    private async getObjectiveFunctionValue(): Promise<string | null> {
        const lstFilePath = this.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        let content: string;
        try {
            content = await fs.promises.readFile(lstFilePath, 'utf-8');
        } catch {
            return null;
        }
        const objectiveFunctionRegex = /OBJECTIVE\s+FUNCTION\s+VALUE\s+WITHOUT\s+CONSTANT:\s*(-?\d+(\.\d+)?)/i;
        const match = content.match(objectiveFunctionRegex);
        if (match) {
            const value = parseFloat(match[1]);
            return `OFV: ${value.toFixed(2)}`;
        }
        return null;
    }

    async checkTerminal(
        activeRunningTerminals: Set<vscode.Terminal>,
        shellIntegrationSeenTerminals: Set<vscode.Terminal>
    ): Promise<void> {
        const fileName = path.basename(this.uri.fsPath);
        for (const terminal of vscode.window.terminals) {
            if (!terminal.name.includes(fileName)) { continue; }
            if (shellIntegrationSeenTerminals.has(terminal)) {
                // Precise mode: coffee only while a command is actively running
                if (activeRunningTerminals.has(terminal)) {
                    this.iconPath = new vscode.ThemeIcon('coffee', new vscode.ThemeColor('charts.yellow'));
                }
            } else {
                // No shell integration available — fallback to original behavior
                this.iconPath = new vscode.ThemeIcon('coffee', new vscode.ThemeColor('charts.yellow'));
            }
            return;
        }
    }
}

export class ModFolder extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
        this.id = uri.fsPath;
        this.resourceUri = uri;
        this.tooltip = uri.fsPath;
        this.contextValue = 'modFolder';
        this.iconPath = {
            light: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'light', 'folder.svg')),
            dark: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'dark', 'folder.svg'))
        };
    }
}
