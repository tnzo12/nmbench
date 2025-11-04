import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ModFileViewerProvider implements vscode.TreeDataProvider<ModFile | ModFolder> {
    private _onDidChangeTreeData: vscode.EventEmitter<ModFile | ModFolder | undefined> = new vscode.EventEmitter<ModFile | ModFolder | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ModFile | ModFolder | undefined> = this._onDidChangeTreeData.event;

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

                for (const file of files) {
                    const filePath = path.join(element.uri.fsPath, file);
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isDirectory()) {
                        folders.push(new ModFolder(vscode.Uri.file(filePath)));
                    } else if (file.match(/\.(mod|ctl)$/)) {
                        const modFile = new ModFile(vscode.Uri.file(filePath));
                        await modFile.checkTerminal();
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
        const children = await Promise.all(files.map(async file => {
            const filePath = path.join(currentDir, file);
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
                return new ModFolder(vscode.Uri.file(filePath));
            } else if (file.match(/\.(mod|ctl)$/)) {
                const modFile = new ModFile(vscode.Uri.file(filePath));
                await modFile.checkTerminal();
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
        const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
        this.tooltip = this.extractDescription(fileContent) || uri.fsPath;
        this.contextValue = 'modFile';

        // Status revealing
        const statuses = this.getStatuses();
        this.tooltip = statuses.map(status => status.text).join(' ');
        this.description = statuses.map(status => status.code).join(' ');

        const objectiveFunctionValue = this.getObjectiveFunctionValue();
        if (objectiveFunctionValue) {
            // 트리에 보일 때 라벨 오른쪽에 표시하고 싶다면:
            this.description = (this.description ?? '') + ` ${objectiveFunctionValue}`;
            // 또는 아예 덮어쓰기 하고 싶다면:
            // this.description = objectiveFunctionValue;
            // 툴팁에만 표시하고 싶다면:
            // this.tooltip = `Objective Function Value: ${objectiveFunctionValue}`;
        }

        if (statuses.length > 0) {
            this.iconPath = this.getStatusIconPath(statuses[0].text);
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
        }


        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.uri]
        };

        this.contextValue = 'modFile';
    }

    private extractDescription(content: string): string | null {
        const descriptionRegex = /.*Description:\\s*(.*)/i;
        const match = content.match(descriptionRegex);
        return match ? match[1] : null;
    }

    private getStatuses(): { text: string, code: string }[] {
        const lstFilePath = this.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        if (!fs.existsSync(lstFilePath)) {
            return [];
        }

        const content = fs.readFileSync(lstFilePath, 'utf-8');
        const statuses: { text: string, code: string }[] = [];
        if (content.includes('MINIMIZATION SUCCESSFUL') || content.includes('REDUCED STOCHASTIC PORTION WAS COMPLETED')) {
            statuses.push({ text: 'Minimization Successful', code: 'S' });
        }
        if (content.includes('TERMINATED') || content.includes('REDUCED STOCHASTIC PORTION WAS NOT COMPLETED')) {
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
        const covarianceStep = content.includes('Elapsed covariance  time in seconds');
        const matrixSingular = content.includes('MATRIX ALGORITHMICALLY');
        if (matrixSingular) {
            statuses.push({ text: 'w Matrix Error', code: 'M' });
        } else if (covarianceStep) {
            statuses.push({ text: 'w Covariance Step done', code: 'C' });
        }

        return statuses;
    }

    private getStatusIconPath(statusText: string): vscode.ThemeIcon {
        switch (statusText) {
            case 'Minimization Successful':
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'));
            case 'Minimization Terminated':
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.red'));
            case 'Simulation':
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.blue'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    private getObjectiveFunctionValue(): string | null {
        const lstFilePath = this.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        if (!fs.existsSync(lstFilePath)) {
            return null;
        }
        const content = fs.readFileSync(lstFilePath, 'utf-8');
        const objectiveFunctionRegex = /OBJECTIVE\s+FUNCTION\s+VALUE\s+WITHOUT\s+CONSTANT:\s*(-?\d+(\.\d+)?)/i;
        const match = content.match(objectiveFunctionRegex);
        if (match) {
            const value = parseFloat(match[1]);
            const roundedValue = value.toFixed(2);
            return `OFV: ${roundedValue}`;
        }
        return null;
    }

    async checkTerminal() {
        const terminals = vscode.window.terminals;
        const fileName = path.basename(this.uri.fsPath);
        for (const terminal of terminals) {
            if (terminal.name.includes(fileName)) {
                this.iconPath = new vscode.ThemeIcon('coffee', new vscode.ThemeColor('charts.yellow'));
                break;
            }
        }
    }
}

export class ModFolder extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = uri.fsPath;
        this.contextValue = 'modFolder';
        this.iconPath = {
            light: path.join(__filename, '..', '..', 'resources', 'light', 'folder.svg'),
            dark: path.join(__filename, '..', '..', 'resources', 'dark', 'folder.svg')
        };
    }
}