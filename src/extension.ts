import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as childProcess from 'child_process';
import { showModFileContextMenu, showModFileContextMenuNONMEM, showRScriptCommand } from './commands';

const readFile = util.promisify(fs.readFile);

class ModFileViewerProvider implements vscode.TreeDataProvider<ModFile | ModFolder> {
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
                return [...folders, ...modFiles];
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

class ModFile extends vscode.TreeItem {
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

class ModFolder extends vscode.TreeItem {
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

/**
 * 공통 로직을 모은 함수
 *  - node가 selection에 없으면 강제로 selection 설정 & reveal
 *  - 폴더면 특정 정규식에 맞는 파일들(.mod/.ctl, .lst 등)을 자동 추가
 *  - 최종 선택된 노드들 반환
 */
async function retrieveSelectionForNode(
    treeView: vscode.TreeView<ModFile | ModFolder>,
    node: ModFile | ModFolder | undefined,
    modFileViewerProvider: ModFileViewerProvider,
    extensionFilter?: RegExp
): Promise<(ModFile | ModFolder)[]> {
    if (!node) {
        vscode.window.showInformationMessage('No items selected.');
        return [];
    }

    let selectedNodes: (ModFile | ModFolder)[] = treeView.selection as (ModFile | ModFolder)[];

    // 폴더/파일 최초 우클릭 시 기존 선택 무시 + reveal
    if (!selectedNodes.some(selected => selected.uri.fsPath === node.uri.fsPath)) {
        selectedNodes = [node];

        await treeView.reveal(node, { select: true, focus: true });
        // 트리 강제 갱신
        setTimeout(() => {
            modFileViewerProvider.refresh(node);
        }, 100);
    }

    // 폴더이고 extensionFilter가 있으면 해당 확장자 파일 자동 추가
    if (node instanceof ModFolder && extensionFilter) {
        try {
            const files = await vscode.workspace.fs.readDirectory(node.uri);
            const matchedFiles = files
                .filter(([name, type]) => type === vscode.FileType.File && extensionFilter.test(name))
                .map(([name]) => new ModFile(vscode.Uri.file(path.join(node.uri.fsPath, name))));

            selectedNodes = [...selectedNodes, ...matchedFiles];
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading folder`);
        }
    }

    return selectedNodes;
}

export function activate(context: vscode.ExtensionContext) {
    const modFileViewerProvider = new ModFileViewerProvider();
    const treeView = vscode.window.createTreeView('modFileViewer', {
        treeDataProvider: modFileViewerProvider,
        canSelectMany: true // 전체 트리에 다중 선택 허용
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.openModFile', (uri: vscode.Uri) => {
            vscode.workspace.openTextDocument(uri).then(doc => {
                vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
            });
        }),

        vscode.commands.registerCommand('extension.refreshModFileViewer', () => {
            modFileViewerProvider.refresh();
        }),

        vscode.commands.registerCommand('extension.showModFileContextMenu', (uri: vscode.Uri) => {
            showModFileContextMenu([uri]);
        }),
        vscode.commands.registerCommand('extension.showModFileContextMenuFromTreeView', async (node?: ModFile | ModFolder) => {
            // 1) 현재 선택된 항목 가져오기
            let selectedNodes = treeView.selection as (ModFile | ModFolder)[];

            // 2) 우클릭한 node가 있고, selection에 없다면 => 그 node만 선택
            if (node && !selectedNodes.some(sel => sel.uri.fsPath === node.uri.fsPath)) {
                selectedNodes = [node];
                // 강제로 트리 뷰에서 node를 선택 & 포커스
                await treeView.reveal(node, { select: true, focus: true });
                // 트리 강제 갱신
                setTimeout(() => {
                    modFileViewerProvider.refresh(node);
                }, 100);
            }

            // 3) 최종적으로 아무것도 선택되지 않았다면 종료
            if (!selectedNodes || selectedNodes.length === 0) {
                vscode.window.showInformationMessage('No items selected.');
                return;
            }

            // 4) 폴더라면 내부 `.mod`/`.ctl` 파일도 자동 추가
            let finalNodes: (ModFile | ModFolder)[] = [];
            for (const item of selectedNodes) {
                // 원래 선택된 항목 먼저 넣고
                finalNodes.push(item);

                // 만약 폴더면 내부 .mod/.ctl 파일 검색하여 추가
                if (item instanceof ModFolder) {
                    try {
                        const files = await vscode.workspace.fs.readDirectory(item.uri);
                        const modFiles = files
                            .filter(([name, fileType]) => fileType === vscode.FileType.File && /\.(mod|ctl)$/i.test(name))
                            .map(([name]) => new ModFile(vscode.Uri.file(path.join(item.uri.fsPath, name))));
                        finalNodes = [...finalNodes, ...modFiles];
                    } catch (error) {
                        vscode.window.showErrorMessage('Error reading folder for context menu.');
                    }
                }
            }

            // 5) 최종적으로 showModFileContextMenu() 호출
            showModFileContextMenu(finalNodes);
        }),
        vscode.commands.registerCommand('extension.showModFileContextMenuNONMEM', (uri: vscode.Uri) => {
            showModFileContextMenuNONMEM([uri], context);
        }),

        vscode.commands.registerCommand('extension.showSumoCommand', async (node?: ModFile | ModFolder) => {
            // 1) 현재 트리뷰 selection 얻기
            let selectedNodes = treeView.selection;

            // 2) 우클릭한 node가 selection에 없다면, 그것만 선택으로 덮어쓰기
            if (node && !selectedNodes.some(selected => selected.uri.fsPath === node.uri.fsPath)) {
                selectedNodes = [node]; // 기존 selection 무시
            }

            if (!selectedNodes || selectedNodes.length === 0) {
                vscode.window.showErrorMessage('No items selected for SUMO.');
                return;
            }

            // 3) 다중 선택된 ModFile들에 대해 .lst 파일 수집
            const lstFiles: vscode.Uri[] = [];

            for (const item of selectedNodes) {
                // 폴더 선택은 무시
                if (!(item instanceof ModFile)) {
                    continue;
                }

                // 파일(.mod/.ctl)이면 .lst 치환
                const lstUri = vscode.Uri.file(item.uri.fsPath.replace(/\.[^.]+$/, '.lst'));
                try {
                    const stat = await vscode.workspace.fs.stat(lstUri);
                    if (stat.type === vscode.FileType.File) {
                        lstFiles.push(lstUri);
                    }
                } catch (err) {
                    // .lst 파일이 없으면 무시
                }
            }

            // 4) .lst 파일이 하나도 없으면 에러
            if (lstFiles.length === 0) {
                vscode.window.showErrorMessage('No .lst files found for SUMO(PsN Summary function)');
                return;
            }

            // 5) SUMO 명령 실행
            const options = { cwd: path.dirname(lstFiles[0].fsPath) };
            vscode.window.showInputBox({
                prompt: 'Enter parameters for Sumo command:',
                // 여러 파일이면 sumo_compare.txt, 아니면 단일 파일명_sumo.txt
                value: `sumo ${lstFiles.map(file => path.basename(file.fsPath)).join(' ')}`
            }).then(input => {
                if (!input) { return; }
                const outputFileName = (lstFiles.length > 1)
                    ? 'sumo_compare.txt'
                    : `${path.basename(lstFiles[0].fsPath, path.extname(lstFiles[0].fsPath))}_sumo.txt`;

                const outputFilePath = path.join(path.dirname(lstFiles[0].fsPath), outputFileName);
                const command = `${input} > "${outputFilePath}" 2>&1`;

                childProcess.exec(command, options, (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showErrorMessage(`Error executing SUMO command: ${stderr}`);
                        return;
                    }

                    fs.readFile(outputFilePath, 'utf-8', (err, data) => {
                        if (err) {
                            vscode.window.showErrorMessage(`Error reading SUMO output: ${err.message}`);
                            return;
                        }

                        // SUMO 결과 확인 WebView
                        const panel = vscode.window.createWebviewPanel(
                            'sumoOutput',
                            outputFileName,
                            vscode.ViewColumn.One,
                            {}
                        );
                        panel.webview.html = getWebviewContent(data);
                    });
                });
            });
        }),

        // for managing Rscript foler (user-definable)
        vscode.commands.registerCommand('extension.manageRScriptCommand', (node: ModFile | ModFolder) => {
            const scriptsFolder = path.join(context.extensionPath, 'Rscripts');
            if (!fs.existsSync(scriptsFolder)) {
                fs.mkdirSync(scriptsFolder);
            }
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(scriptsFolder), true);
        }),

        vscode.commands.registerCommand('extension.showRScriptCommandFromTreeView', async (node?: ModFile | ModFolder) => {
            // 현재 트리뷰에서 선택된 항목들
            let selectedNodes = treeView.selection as (ModFile | ModFolder)[];

            // 우클릭된 node가 selection에 포함되어 있지 않다면, 해당 node만 선택
            if (node && !selectedNodes.some(sel => sel.uri.fsPath === node.uri.fsPath)) {
                selectedNodes = [node];
                // 강제로 트리 뷰에서 해당 노드를 선택 & 포커스
                await treeView.reveal(node, { select: true, focus: true });
            }

            // 선택된 항목이 없으면 메시지 띄우고 종료
            if (!selectedNodes || selectedNodes.length === 0) {
                vscode.window.showInformationMessage('No items selected.');
                return;
            }

            // RScriptCommand 실행 (실제로는 showRScriptCommand 내부에서 로직 수행)
            showRScriptCommand(context, selectedNodes);
        }),

        vscode.commands.registerCommand('extension.showRScriptCommandFromEditor', (uri: vscode.Uri) => {
            showRScriptCommand(context, [uri]);
        }),

        vscode.commands.registerCommand('extension.showLinkedFiles', async (node: ModFile) => {
            if (!node) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No file selected.');
                    return;
                }
                const document = editor.document;
                if (!document || !document.uri.fsPath.match(/\.(mod|ctl)$/)) {
                    vscode.window.showErrorMessage('The active file is not a MOD or CTL file.');
                    return;
                }
                node = new ModFile(document.uri);
            }

            const dir = path.dirname(node.uri.fsPath);
            const baseName = path.basename(node.uri.fsPath, path.extname(node.uri.fsPath));

            fs.readdir(dir, async (err, files) => {
                if (err) {
                    vscode.window.showErrorMessage(`Error reading directory: ${err.message}`);
                    return;
                }

                const linkedFiles = files
                    .filter(file => path.basename(file, path.extname(file)) === baseName && file !== path.basename(node.uri.fsPath))
                    .map(file => ({
                        label: path.basename(file),
                        description: path.join(dir, file)
                    }));

                const additionalFiles: { label: string; description: string; }[] = [];
                const fileContent = await readFile(node.uri.fsPath, 'utf-8');
                const tableLines = fileContent.split('\n').filter(line => line.includes('$TABLE'));
                tableLines.forEach(line => {
                    const match = line.match(/\bFILE\s*=\s*(\S+)/i);
                    if (match) {
                        const fileName = match[1];
                        const foundFiles = files
                            .filter(file => path.basename(file) === fileName)
                            .map(file => ({
                                label: path.basename(file),
                                description: path.join(dir, file)
                            }));
                        additionalFiles.push(...foundFiles);
                    }
                });

                const allFiles = [...linkedFiles, ...additionalFiles];
                if (allFiles.length === 0) {
                    vscode.window.showInformationMessage('No linked files found.');
                    return;
                }

                vscode.window.showQuickPick(allFiles).then(selected => {
                    if (selected) {
                        vscode.workspace.openTextDocument(vscode.Uri.file(selected.description!)).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            });
        }),

        vscode.commands.registerCommand('extension.showHeatmap', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileName = document.fileName; // 파일 이름 가져오기
                const baseFileName = path.basename(fileName); // 경로를 제외한 파일 이름

                const data = await readNmTable_heatmap(fileName);
                const panel = vscode.window.createWebviewPanel(
                    'nmTablePlot',
                    baseFileName, // 패널 이름을 파일 이름으로 설정
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                // Get the current theme
                const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
                panel.webview.html = getWebviewContent_heatmap_plotly(data, theme, baseFileName);

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(message => {
                    if (message.command === 'updatePlot') {
                        panel.webview.postMessage({ command: 'plotData', data: data, config: message.config });
                    }
                });
            }
        }),

        vscode.commands.registerCommand('extension.readExtFile', async (uri: vscode.Uri) => {
            const extUri = vscode.Uri.file(uri.fsPath.replace(/\.[^.]+$/, '.ext'));
            if (fs.existsSync(extUri.fsPath)) {
                const data = await readNmTable_ext(extUri.fsPath);
                const panel = vscode.window.createWebviewPanel(
                    'extTable',
                    'EXT Table',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                // Get the current theme
                const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
                panel.webview.html = getWebviewContent_table(data, theme);

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(message => {
                    if (message.command === 'updateTable') {
                        panel.webview.postMessage({ command: 'tableData', data: data, config: message.config });
                    }
                });
            } else {
                vscode.window.showErrorMessage('The corresponding .ext file does not exist.');
            }
        })
    );

    treeView.onDidChangeSelection(event => {
        const selected = event.selection[0];
        if (selected instanceof ModFile) {
            vscode.commands.executeCommand('extension.openModFile', selected.uri);
        }
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.uri.scheme === 'file' && editor.document.uri.fsPath.match(/\.(mod|ctl)$/)) {
            modFileViewerProvider.getModFileOrFolder(editor.document.uri).then(item => {
                if (item) {
                    treeView.reveal(item, { select: true, focus: true });
                }
            });
        }
    });

    vscode.window.onDidOpenTerminal(() => {
        modFileViewerProvider.refresh();
    });

    vscode.window.onDidCloseTerminal(() => {
        modFileViewerProvider.refresh();
    });

    vscode.window.onDidChangeActiveTerminal(() => {
        modFileViewerProvider.refresh();
    });
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.readNmTableAndPlot', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileName = document.fileName;

                // if (fileName.match(/sdtab\\d*|patab\\d*/)) {
                const data = await readNmTable(fileName);
                const panel = vscode.window.createWebviewPanel(
                    'nmTablePlot',
                    'NM Table Plot',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                // Get the current theme
                const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
                panel.webview.html = getWebviewContent_plotly(data, theme);

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(message => {
                    if (message.command === 'updatePlot') {
                        panel.webview.postMessage({ command: 'plotData', data: data, config: message.config });
                    }
                });
                // }
            }
        })
    );

    vscode.commands.registerCommand('extension.showHistogram', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const fileName = document.fileName;
            // if (fileName.match(/sdtab\\d*|patab\\d*/)) {
            const data = await readNmTable(fileName);
            const panel = vscode.window.createWebviewPanel(
                'histogramPlot',
                'Histogram Plot',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            // Get the current theme
            const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
            panel.webview.html = getWebviewContent_hist(data, theme);
            // }
        }
    });
}

// 아래 함수들은 기존 로직을 그대로 유지
function getWebviewContent(output: string): string {
    const thetaClass = 'theta-highlight';
    const omegaClass = 'omega-highlight';
    const sigmaClass = 'sigma-highlight';

    const highlightedOutput = output.replace(/(^|\n)((?:[^\n]*?\b(THETA|OMEGA|SIGMA)\b[^\n]*?)($|\n))/gm, (match, lineStart, lineContent) => {
        if (lineContent.includes('THETA') && lineContent.includes('OMEGA') && lineContent.includes('SIGMA')) {
            const thetaRegex = /\bTHETA\b/g;
            const omegaRegex = /\bOMEGA\b/g;
            const sigmaRegex = /\bSIGMA\b/g;
            return lineStart + lineContent
                .replace(thetaRegex, `<span class="${thetaClass}">THETA</span>`)
                .replace(omegaRegex, `<span class="${omegaClass}">OMEGA</span>`)
                .replace(sigmaRegex, `<span class="${sigmaClass}">SIGMA</span>`);
        }
        return match;
    });

    const styledOutput = highlightedOutput.replace(/\b(OK|WARNING|ERROR)\b/g, match => {
        switch (match) {
            case 'OK':
                return `<span class="ok-highlight">${match}</span>`;
            case 'WARNING':
                return `<span class="warning-highlight">${match}</span>`;
            case 'ERROR':
                return `<span class="error-highlight">${match}</span>`;
            default:
                return match;
        }
    });

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sumo Output</title>
            <style>
                .${thetaClass} { color: #6699cc; }
                .${omegaClass} { color: #66cc99; }
                .${sigmaClass} { color: #ff6666; }
                .ok-highlight { color: #66cc99; }
                .warning-highlight { color: orange; }
                .error-highlight { color: #ff6666; }
            </style>
        </head>
        <body>
            <pre>${styledOutput}</pre>
        </body>
        </html>
    `;
}
async function readNmTable(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            const lines = data.split('\n').filter(line => line.trim() !== '');
            const header = lines[1].trim().split(/\s+/);
            const rows = lines.slice(2).map(line => {
                const values = line.trim().split(/\s+/);
                const row: { [key: string]: string | number } = {};
                header.forEach((col, index) => {
                    row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                });
                return row;
            });
            resolve(rows);
        });
    });
}
async function readNmTable_heatmap(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            const lines = data.split('\n').filter(line => line.trim() !== '');
            const header = lines[1].trim().split(/\s+/);
            const rows = lines.slice(1).map(line => {
                const values = line.trim().split(/\s+/);
                const row: { [key: string]: string | number } = {};
                header.forEach((col, index) => {
                    row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                });
                return row;
            });
            resolve(rows);
        });
    });
}
async function readNmTable_ext(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            // Split the content into lines
            const lines = data.split('\n').filter(line => line.trim() !== '');

            // Split into sections based on "TABLE NO"
            const sections: { tableNoLine: string, lines: string[] }[] = [];
            let currentSection: string[] = [];
            let currentTableNoLine = '';

            lines.forEach(line => {
                if (line.trim().startsWith('TABLE NO')) {
                    if (currentSection.length > 0) {
                        sections.push({ tableNoLine: currentTableNoLine, lines: currentSection });
                    }
                    currentSection = [line];
                    currentTableNoLine = line;
                } else {
                    currentSection.push(line);
                }
            });
            if (currentSection.length > 0) {
                sections.push({ tableNoLine: currentTableNoLine, lines: currentSection });
            }

            // Process each section
            const tables = sections.map(({ tableNoLine, lines }) => {
                const headerLine = lines.find(line => line.trim().startsWith('ITERATION'));
                if (!headerLine) {
                    return null;
                }

                const header = headerLine.trim().split(/\s+/);
                const rows = lines
                    .filter(line => !line.trim().startsWith('TABLE NO') && !line.trim().startsWith('ITERATION'))
                    .map(line => {
                        const values = line.trim().split(/\s+/);
                        const row: { [key: string]: string | number } = {};
                        header.forEach((col, index) => {
                            row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                        });
                        return row;
                    });

                // Separate rows where ITERATION is greater than -1000000000 and less than or equal to -1000000000
                const filteredRows = rows.filter(row => (row['ITERATION'] as number) > -1000000000);
                const extendedRows = rows.filter(row => (row['ITERATION'] as number) <= -1000000000);

                if (filteredRows.length === 0) {
                    return null;
                }

                const firstRow = filteredRows[0];
                const lastRow = filteredRows[filteredRows.length - 1];

                // Sparkline data for each column
                const sparklineData: { [key: string]: number[] } = {};
                header.forEach(col => {
                    if (typeof firstRow[col] === 'number') {
                        sparklineData[col] = filteredRows.map(row => row[col] as number);
                    }
                });

                return { tableNoLine, firstRow, lastRow, sparklineData, header, extendedRows };
            }).filter(table => table !== null);

            resolve(tables);
        });
    });
}
function getWebviewContent_plotly(data: any[], theme: string): string {
    const columns = Object.keys(data[0]);

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const controlTextColor = isDarkTheme ? 'white' : 'black';

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
                .controls { 
                    position: absolute; 
                    top: 10px; 
                    left: 10px; 
                    z-index: 100; 
                    background: rgba(255, 255, 255, 0.8); 
                    padding: 10px; 
                    border-radius: 5px; 
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); 
                    cursor: move; 
                    display: flex; 
                    flex-direction: column; 
                    gap: 5px; 
                    color: ${controlTextColor}; 
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                .controls button { margin-top: 5px; }
                .controls input[type="number"] { width: 50px; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="xSelect">X-axis:</label>
                <select id="xSelect">${columns.map(col => `<option value="${col}" ${col === "TIME" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="ySelect">Y-axis:</label>
                <select id="ySelect" multiple size="6">${columns.map(col => `<option value="${col}" ${col === "DV" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="groupSelect">Grouping Variable:</label>
                <select id="groupSelect">${columns.map(col => `<option value="${col}" ${col === "ID" ? "selected" : ""}>${col}</option>`).join('')}</select>
                <label for="groupValues">Group Values:</label>
                <select id="groupValues" multiple size="6"></select>
                <button id="updatePlot">Update Plot</button>
                <button id="addYXLine">Add y=x Line</button>
                <button id="toggleSubplot">Toggle Subplot</button>
                <div class="button-row">
                  <button id="toggleXTicks">X Ticks</button>
                  <button id="toggleYTicks">Y Ticks</button>
                </div>
                <button id="clearPlot">Clear Plot</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let yxLineAdded = false;
                let subplotMode = true;
                let xTicksVisible = true;
                let yTicksVisible = true;
                const colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];

                const controls = document.getElementById("controls");
                let isDragging = false;
                let offsetX, offsetY;
                let currentData = ${JSON.stringify(data)};

                controls.addEventListener("mousedown", (e) => {
                    isDragging = true;
                    offsetX = e.clientX - controls.offsetLeft;
                    offsetY = e.clientY - controls.offsetTop;
                });

                document.addEventListener("mousemove", (e) => {
                    if (isDragging) {
                        controls.style.left = (e.clientX - offsetX) + "px";
                        controls.style.top = (e.clientY - offsetY) + "px";
                    }
                });

                document.addEventListener("mouseup", () => {
                    isDragging = false;
                });

                document.getElementById("groupSelect").addEventListener("change", function () {
                    updateGroupValues();
                });

                document.getElementById("updatePlot").addEventListener("click", function () {
                    updatePlot();
                });

                document.getElementById("addYXLine").addEventListener("click", function () {
                    yxLineAdded = !yxLineAdded;
                    updatePlot();
                });

                document.getElementById("toggleSubplot").addEventListener("click", function () {
                    subplotMode = !subplotMode;
                    updatePlot();
                });

                document.getElementById("toggleXTicks").addEventListener("click", function () {
                    xTicksVisible = !xTicksVisible;
                    updatePlot();
                });

                document.getElementById("toggleYTicks").addEventListener("click", function () {
                    yTicksVisible = !yTicksVisible;
                    updatePlot();
                });

                document.getElementById("clearPlot").addEventListener("click", function () {
                    Plotly.purge("plot");
                });

                  window.onresize = function() {
                    updatePlot(); // update when window size changes
                };

                function updateGroupValues() {
                    const group = document.getElementById("groupSelect").value;
                    const uniqueValues = Array.from(new Set(currentData.map(row => row[group])));
                    const groupValuesSelect = document.getElementById("groupValues");
                    groupValuesSelect.innerHTML = uniqueValues.map(val => \`<option value="\${val}">\${val}</option>\`).join('');
                }

                function updatePlot() {
                    const x = document.getElementById("xSelect").value;
                    const yOptions = Array.from(document.getElementById("ySelect").selectedOptions).map(option => option.value);
                    const group = document.getElementById("groupSelect").value;
                    const groupValues = Array.from(document.getElementById("groupValues").selectedOptions).map(option => option.value);

                    // If no group values are selected, select all unique group values
                    const selectedGroupValues = groupValues.length > 0 ? groupValues : Array.from(new Set(currentData.map(row => row[group])));
                    const filteredData = currentData.filter(row => selectedGroupValues.includes(row[group]));

                    vscode.postMessage({ command: "updatePlot", config: { x: x, y: yOptions, group: group, groupValues: selectedGroupValues, addYXLine: yxLineAdded, subplotMode: subplotMode, xTicksVisible: xTicksVisible, yTicksVisible: yTicksVisible }, data: filteredData });
                }

                window.addEventListener("message", function (event) {
                    const message = event.data;
                    if (message.command === "plotData") {
                        currentData = message.data;
                        const config = message.config;

                        const groups = config.groupValues.length > 0 ? config.groupValues : Array.from(new Set(currentData.map(row => row[config.group])));
                        const figData = [];
                        const layout = {
                            showlegend: true,
                            legend: { orientation: "h", y: -0.01 },
                            margin: { t: 20, b: 20, l: 40, r: 20 },
                            paper_bgcolor: '${backgroundColor}',
                            plot_bgcolor: '${backgroundColor}',
                            font: { color: '${axisColor}' }
                        };

                        if (config.subplotMode) {
                            const plotWidth = document.getElementById("plot").clientWidth;
                            const numCols = Math.max(1, Math.floor(plotWidth / 250));
                            const numRows = Math.ceil(groups.length / numCols);

                            // Adjust numCols if there are fewer subplots than columns
                            const adjustedNumCols = groups.length < numCols ? groups.length : numCols;

                            layout.grid = { rows: numRows, columns: adjustedNumCols, pattern: "independent" };
                            const xGap = 0.02;
                            const yGap = 0.02;
                            const annotations = [];

                            groups.forEach(function (group, i) {
                                const filteredGroupData = currentData.filter(row => row[config.group] == group);
                                config.y.forEach((yAxis, j) => {
                                    const trace = {
                                        x: filteredGroupData.map(row => row[config.x]),
                                        y: filteredGroupData.map(row => row[yAxis]),
                                        type: "scatter",
                                        mode: "lines+markers",
                                        name: yAxis,
                                        xaxis: "x" + (i + 1),
                                        yaxis: "y" + (i + 1),
                                        marker: { color: colors[j % colors.length] },
                                        showlegend: i === 0
                                    };
                                    figData.push(trace);
                                    if (config.addYXLine) {
                                        const minVal = Math.min(...filteredGroupData.map(row => Math.min(row[config.x], row[yAxis])));
                                        const maxVal = Math.max(...filteredGroupData.map(row => Math.max(row[config.x], row[yAxis])));
                                        const lineTrace = {
                                            x: [minVal, maxVal],
                                            y: [minVal, maxVal],
                                            type: "scatter",
                                            mode: "lines",
                                            line: { dash: "dash", color: "grey" },
                                            showlegend: false,
                                            xaxis: "x" + (i + 1),
                                            yaxis: "y" + (i + 1)
                                        };
                                        figData.push(lineTrace);
                                    }
                                });
                                const row = Math.floor(i / adjustedNumCols) + 1;
                                const col = (i % adjustedNumCols) + 1;
                                const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                                const xDomainEnd = col / adjustedNumCols - xGap;
                                const yDomainStart = 1 - row / numRows + yGap;
                                const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                                layout["xaxis" + (i + 1)] = { domain: [xDomainStart, xDomainEnd], showticklabels: config.xTicksVisible };
                                layout["yaxis" + (i + 1)] = { domain: [yDomainStart, yDomainEnd], showticklabels: config.yTicksVisible };

                                annotations.push({
                                    x: xDomainStart + (xDomainEnd - xDomainStart) / 2,
                                    y: yDomainEnd,
                                    xref: "paper",
                                    yref: "paper",
                                    text: group,
                                    showarrow: false,
                                    xanchor: "center",
                                    yanchor: "bottom"
                                });
                            });

                            layout.annotations = annotations.concat([
                                {
                                    text: config.x,
                                    x: 0.5,
                                    xref: "paper",
                                    y: 0,
                                    yref: "paper",
                                    showarrow: false,
                                    xanchor: "center",
                                    yanchor: "top"
                                },
                                {
                                    text: config.y.join(", "),
                                    x: 0,
                                    xref: "paper",
                                    y: 0.5,
                                    yref: "paper",
                                    showarrow: false,
                                    xanchor: "right",
                                    yanchor: "middle",
                                    textangle: -90
                                }
                            ]);
                        } else {
                            config.y.forEach((yAxis, j) => {
                                groups.forEach(function (group, i) {
                                    const filteredGroupData = currentData.filter(row => row[config.group] == group);
                                    const trace = {
                                        x: filteredGroupData.map(row => row[config.x]),
                                        y: filteredGroupData.map(row => row[yAxis]),
                                        type: "scatter",
                                        mode: "lines+markers",
                                        name: yAxis,
                                        marker: { color: colors[j % colors.length] },
                                        showlegend: i === 0
                                    };
                                    figData.push(trace);
                                    if (config.addYXLine) {
                                        const minVal = Math.min(...filteredGroupData.map(row => Math.min(row[config.x], row[yAxis])));
                                        const maxVal = Math.max(...filteredGroupData.map(row => Math.max(row[config.x], row[yAxis])));
                                        const lineTrace = {
                                            x: [minVal, maxVal],
                                            y: [minVal, maxVal],
                                            type: "scatter",
                                            mode: "lines",
                                            line: { dash: "dash", color: "grey" },
                                            showlegend: false
                                        };
                                        figData.push(lineTrace);
                                    }
                                });
                            });

                            layout.xaxis = { title: config.x, showticklabels: config.xTicksVisible };
                            layout.yaxis = { title: config.y.join(", "), showticklabels: config.yTicksVisible };
                        }

                        Plotly.newPlot("plot", figData, layout, { responsive: true });

                        updateGroupValues();
                    }
                });

                updateGroupValues();
                updatePlot();
            </script>
        </body>
        </html>
    `;
}
function getWebviewContent_hist(data: any[], theme: string): string {
    const columns = Object.keys(data[0]);

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const controlTextColor = isDarkTheme ? 'white' : 'black';
    const annotationColor = isDarkTheme ? 'white' : 'black';
    const borderColor = isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'; // 연한 테두리 색상

    // Generate column options HTML
    const columnOptions = columns.map(col => `<option value="${col}">${col}</option>`).join('');

    // Generate HTML content
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
                .controls { 
                    position: absolute; 
                    top: 10px; 
                    left: 10px; 
                    z-index: 100; 
                    background: rgba(255, 255, 255, 0.8); 
                    padding: 10px; 
                    border-radius: 5px; 
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); 
                    cursor: move; 
                    display: flex; 
                    flex-direction: column; 
                    gap: 5px; 
                    color: ${controlTextColor}; 
                }
                .controls label, .controls select, .controls button, .controls input { font-size: 0.8em; }
                .controls button { margin-top: 5px; }
                .controls input[type="number"] { width: 50px; }
            </style>
        </head>
        <body>
            <div class="controls" id="controls">
                <label for="columnSelect">Columns:</label>
                <select id="columnSelect" multiple size="6">${columnOptions}</select>
                <label for="groupSelect">Group by:</label>
                <select id="groupSelect">
                    <option value="">None</option>${columnOptions}
                </select>
                <button id="updatePlot">Update Plot</button>
                <button id="togglePlot">Toggle Splom</button>
            </div>
            <div id="plot"></div>
            <script>
                const vscode = acquireVsCodeApi();
                let currentData = ${JSON.stringify(data)};
                let plotType = "histogram"; // Initial plot type

                const controls = document.getElementById("controls");
                const columnSelect = document.getElementById("columnSelect");
                const groupSelect = document.getElementById("groupSelect");
                let isDragging = false;
                let offsetX, offsetY;

                // Initialize column select with all options selected
                Array.from(columnSelect.options).forEach(option => option.selected = true);

                controls.addEventListener("mousedown", (e) => {
                    isDragging = true;
                    offsetX = e.clientX - controls.offsetLeft;
                    offsetY = e.clientY - controls.offsetTop;
                });

                document.addEventListener("mousemove", (e) => {
                    if (isDragging) {
                        controls.style.left = (e.clientX - offsetX) + "px";
                        controls.style.top = (e.clientY - offsetY) + "px";
                    }
                });

                document.addEventListener("mouseup", () => {
                    isDragging = false;
                });

                document.getElementById("updatePlot").addEventListener("click", function () {
                    updatePlot();
                });

                document.getElementById("togglePlot").addEventListener("click", function () {
                    plotType = plotType === "histogram" ? "splom" : "histogram";
                    updatePlot();
                });

                window.onresize = function() {
                    updatePlot(); // update when window size changes
                };

                function updatePlot() {
                    const selectedColumns = Array.from(document.getElementById("columnSelect").selectedOptions).map(option => option.value);
                    const groupByColumn = document.getElementById("groupSelect").value;

                    // If no columns are selected, select all columns
                    const columnsToPlot = selectedColumns.length > 0 ? selectedColumns : ${JSON.stringify(columns)};

                    if (plotType === "histogram") {
                        plotHistogram(columnsToPlot, groupByColumn);
                    } else {
                        plotCustomSplom(columnsToPlot, groupByColumn);
                    }
                }

                function plotHistogram(columnsToPlot, groupByColumn) {
                    let plotData = [];
                    let showLegend = false;
                    if (groupByColumn) {
                        const uniqueGroups = [...new Set(currentData.map(row => row[groupByColumn]))];
                        const colors = Plotly.d3.scale.category10().range();
                        columnsToPlot.forEach((column, index) => {
                            uniqueGroups.forEach((group, groupIndex) => {
                                plotData.push({
                                    x: currentData.filter(row => row[groupByColumn] === group).map(row => row[column]),
                                    type: 'histogram',
                                    name: column + ' (' + group + ')',
                                    marker: { color: colors[groupIndex % colors.length] },
                                    xaxis: 'x' + (index + 1),
                                    yaxis: 'y' + (index + 1),
                                    autobinx: false,
                                    histnorm: "count",
                                    nbinsx: Math.ceil(currentData.length * 0.25) // Coarser binning
                                });
                            });
                        });
                        showLegend = true;
                    } else {
                        plotData = columnsToPlot.map((column, index) => {
                            return {
                                x: currentData.map(row => row[column]),
                                type: 'histogram',
                                name: column,
                                marker: { color: "rgba(255, 102, 102, 0.8)" }, // Semi-transparent red color
                                xaxis: 'x' + (index + 1),
                                yaxis: 'y' + (index + 1),
                                autobinx: false,
                                histnorm: "count",
                                nbinsx: Math.ceil(currentData.length * 0.25) // Coarser binning
                            };
                        });
                    }

                    const layout = {
                        showlegend: showLegend, // Show legend if grouping is applied
                        legend: {
                            orientation: 'h',
                            y: -0.2 // Position the legend below the plot
                        },
                        paper_bgcolor: '${backgroundColor}',
                        plot_bgcolor: '${backgroundColor}',
                        font: { color: '${axisColor}' },
                        margin: { t: 20, b: 20, l: 40, r: 20 }, // Reduced margins
                        grid: { rows: Math.ceil(columnsToPlot.length / Math.max(1, Math.floor(document.getElementById("plot").clientWidth / 250))), columns: Math.max(1, Math.floor(document.getElementById("plot").clientWidth / 250)), pattern: "independent" }
                    };

                    const plotWidth = document.getElementById("plot").clientWidth;
                    const numCols = Math.max(1, Math.floor(plotWidth / 250));
                    const numRows = Math.ceil(columnsToPlot.length / numCols);
                    const adjustedNumCols = columnsToPlot.length < numCols ? columnsToPlot.length : numCols;

                    const xGap = 0.02;
                    const yGap = 0.025;
                    const annotations = [];

                    columnsToPlot.forEach((column, index) => {
                        const row = Math.floor(index / adjustedNumCols) + 1;
                        const col = (index % adjustedNumCols) + 1;
                        const xDomainStart = (col - 1) / adjustedNumCols + xGap;
                        const xDomainEnd = col / adjustedNumCols - xGap;
                        const yDomainStart = 1 - row / numRows + yGap;
                        const yDomainEnd = 1 - (row - 1) / numRows - yGap;
                        layout["xaxis" + (index + 1)] = { domain: [xDomainStart, xDomainEnd], showticklabels: true, matches: null, tickangle: 90, gridcolor: '${borderColor}' };
                        layout["yaxis" + (index + 1)] = { domain: [yDomainStart, yDomainEnd], showticklabels: true, autorange: true, matches: null, tickangle: 0, gridcolor: '${borderColor}' };

                        annotations.push({
                            x: xDomainStart + (xDomainEnd - xDomainStart) / 2,
                            y: yDomainEnd,
                            xref: "paper",
                            yref: "paper",
                            text: column,
                            showarrow: false,
                            xanchor: "center",
                            yanchor: "bottom"
                        });
                    });

                    layout.annotations = annotations.concat([
                        {
                            text: "Count",
                            x: -0.05,
                            xref: "paper",
                            y: 0.5,
                            yref: "paper",
                            showarrow: false,
                            xanchor: "center",
                            yanchor: "middle",
                            textangle: -90
                        }
                    ]);

                    // Clear any existing plots before plotting new data
                    Plotly.purge('plot');

                    // Create new plot with updated data
                    Plotly.newPlot('plot', plotData, layout, { responsive: true });
                }

                function plotCustomSplom(columnsToPlot, groupByColumn) {
                    const plotData = [];
                    const layout = {
                        showlegend: false, // Hide legend
                        paper_bgcolor: '${backgroundColor}',
                        plot_bgcolor: '${backgroundColor}',
                        font: { color: '${axisColor}' },
                        margin: { t: 20, b: 20, l: 40, r: 20 },
                        grid: {
                            rows: columnsToPlot.length,
                            columns: columnsToPlot.length,
                            pattern: 'independent'
                        }
                    };

                    const annotations = [];
                    const uniqueGroups = groupByColumn ? [...new Set(currentData.map(row => row[groupByColumn]))] : [''];
                    const colors = Plotly.d3.scale.category10().range();

                    columnsToPlot.forEach((xCol, xIndex) => {
                        columnsToPlot.forEach((yCol, yIndex) => {
                            const index = xIndex * columnsToPlot.length + yIndex + 1;
                            if (xIndex === yIndex) {
                                // Diagonal (histogram with label)
                                uniqueGroups.forEach((group, groupIndex) => {
                                    plotData.push({
                                        x: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[xCol]),
                                        type: 'histogram',
                                        marker: { color: colors[groupIndex % colors.length] },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        autobinx: true
                                    });
                                });
                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, matches: null, gridcolor: '${borderColor}' };

                                annotations.push({
                                    x: (xIndex + 0.5) / columnsToPlot.length,
                                    y: 1 - (yIndex + 0.5) / columnsToPlot.length,
                                    xref: 'paper',
                                    yref: 'paper',
                                    text: xCol,
                                    showarrow: false,
                                    font: { color: '${annotationColor}', size: 12 },
                                    xanchor: 'center',
                                    yanchor: 'middle'
                                });

                                // Add tick labels to the diagonal cells
                                if (xIndex === columnsToPlot.length - 1) {
                                    layout['xaxis' + index].showticklabels = false;
                                    layout['xaxis' + index].tickangle = 90;
                                }
                                if (yIndex === 0) {
                                    layout['yaxis' + index].showticklabels = true;
                                    layout['yaxis' + index].tickangle = 0;
                                }
                            } else if (xIndex < yIndex) {
                                // Upper triangle (scatter plot with regression line)
                                const xData = currentData.map(row => row[xCol]);
                                const yData = currentData.map(row => row[yCol]);
                                const regression = linearRegression(xData, yData);

                                uniqueGroups.forEach((group, groupIndex) => {
                                    plotData.push({
                                        x: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[xCol]),
                                        y: currentData.filter(row => groupByColumn ? row[groupByColumn] === group : true).map(row => row[yCol]),
                                        mode: 'markers',
                                        type: 'scatter',
                                        marker: { color: colors[groupIndex % colors.length] },
                                        xaxis: 'x' + index,
                                        yaxis: 'y' + index,
                                        showlegend: false
                                    });
                                });

                                plotData.push({
                                    x: [Math.min(...xData), Math.max(...xData)],
                                    y: [regression.slope * Math.min(...xData) + regression.intercept, regression.slope * Math.max(...xData) + regression.intercept],
                                    mode: 'lines',
                                    type: 'scatter',
                                    line: { color: 'rgba(255, 102, 0, 0.8)', width: 3 }, // Prominent regression line
                                    xaxis: 'x' + index,
                                    yaxis: 'y' + index,
                                    showlegend: false
                                });

                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                            } else {
                                // Lower triangle (text with Pearson correlation coefficient)
                                const xData = currentData.map(row => row[xCol]);
                                const yData = currentData.map(row => row[yCol]);
                                const correlation = pearsonCorrelation(xData, yData).toFixed(2);
                                let significance = '';
                                if (Math.abs(correlation) > 0.9) {
                                    significance = '***';
                                } else if (Math.abs(correlation) > 0.7) {
                                    significance = '**';
                                } else if (Math.abs(correlation) > 0.5) {
                                    significance = '*';
                                }
                                annotations.push({
                                    x: (xIndex + 0.5) / columnsToPlot.length,
                                    y: 1 - (yIndex + 0.5) / columnsToPlot.length,
                                    xref: 'paper',
                                    yref: 'paper',
                                    text: 'r: ' + correlation + significance,
                                    showarrow: false,
                                    font: { color: '${annotationColor}', size: 12 },
                                    xanchor: 'center',
                                    yanchor: 'middle'
                                });

                                layout['xaxis' + index] = { domain: [xIndex / columnsToPlot.length, (xIndex + 1) / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                                layout['yaxis' + index] = { domain: [1 - (yIndex + 1) / columnsToPlot.length, 1 - yIndex / columnsToPlot.length], showgrid: false, zeroline: false, showline: true, showticklabels: false, gridcolor: '${borderColor}' };
                            }
                        });
                    });

                    layout.annotations = annotations;

                    // Clear any existing plots before plotting new data
                    Plotly.purge('plot');

                    // Create new plot with updated data
                    Plotly.newPlot('plot', plotData, layout, { responsive: true });
                }

                function pearsonCorrelation(x, y) {
                    const n = x.length;
                    const sumX = x.reduce((a, b) => a + b, 0);
                    const sumY = y.reduce((a, b) => a + b, 0);
                    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
                    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
                    const sumYY = y.reduce((acc, yi) => acc + yi * yi, 0);

                    const numerator = n * sumXY - sumX * sumY;
                    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
                    return numerator / denominator;
                }

                function linearRegression(x, y) {
                    const n = x.length;
                    const sumX = x.reduce((a, b) => a + b, 0);
                    const sumY = y.reduce((a, b) => a + b, 0);
                    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
                    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);

                    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
                    const intercept = (sumY - slope * sumX) / n;

                    return { slope, intercept };
                }

                // Initial plot update
                updatePlot();
            </script>
        </body>
        </html>
    `;
}
function getWebviewContent_heatmap_plotly(data: any[], theme: string, fileName: string): string {
    const xLabels = Object.values(data[0]).slice(1) as string[]; // 첫 행의 첫 열을 제외한 값
    const yLabels = data.slice(1).map(row => Object.values(row)[0] as string); // 첫 열의 첫 행을 제외한 값
    const originalZValues = data.slice(1).map(row => Object.values(row).slice(1).map(value => Number(value)) as number[]); // 원래 값들
    const ignoreDiagonals = !fileName.endsWith('.phi'); // 확장자가 .phi이면 대각 요소를 색칠하지 않음
    const zValues = originalZValues.map((row, rowIndex) =>
        row.map((value, colIndex) => {
            if (ignoreDiagonals && rowIndex === colIndex) { return NaN; } // 대각선 요소는 NaN으로 설정하여 색상 제거
            return value === 0 ? 0 : Math.tanh(Math.abs(value)) * Math.sign(value); // zValues를 tanh 스케일로 변환
        })
    );

    const textValues = originalZValues.map(row => row.map(value => value.toFixed(2))); // 텍스트 값 생성, 소수점 둘째 자리까지 반올림

    // Determine colors based on the theme
    const isDarkTheme = theme === 'vscode-dark' || theme === 'vscode-high-contrast';
    const axisColor = isDarkTheme ? 'white' : 'black';
    const backgroundColor = 'rgba(0, 0, 0, 0)'; // Transparent
    const gridColor = isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)'; // 옅은 그리드 색상

    // Generate annotations for each cell
    const annotations = [];
    for (let i = 0; i < yLabels.length; i++) {
        for (let j = 0; j < xLabels.length; j++) {
            annotations.push({
                x: xLabels[j],
                y: yLabels[i],
                text: textValues[i][j], // display untransformed val.
                xref: 'x1',
                yref: 'y1',
                showarrow: false,
                textangle: -45, // Text angle
                font: {
                    color: axisColor
                }
            });
        }
    }

    // Create custom colorscale to adjust opacity for zero values
    const colorscale = [
        [0, 'rgba(102, 153, 204, 1)'],
        [0.25, 'rgba(153, 204, 204, 0.8)'],
        [0.5, 'rgba(190, 190, 190, 0.4)'],
        [0.75, 'rgba(220, 170, 132, 0.8)'],
        [1, 'rgba(255, 102, 102, 1)']
    ];

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body { margin: 0; padding: 0; }
                #plot { width: 100vw; height: 100vh; background: transparent; }
            </style>
        </head>
        <body>
            <div id="plot"></div>
            <script>
                const xLabels = ${JSON.stringify(xLabels)};
                const yLabels = ${JSON.stringify(yLabels)};
                const originalZValues = ${JSON.stringify(originalZValues)};
                let zValues = ${JSON.stringify(zValues)};
                const textValues = ${JSON.stringify(textValues)};
                const annotations = ${JSON.stringify(annotations)};
                const colorscale = ${JSON.stringify(colorscale)};
                const axisColor = '${axisColor}';
                const backgroundColor = '${backgroundColor}';
                const gridColor = '${gridColor}';
                const ignoreDiagonals = ${ignoreDiagonals};

                function getZValues(ignoreDiagonals) {
                    return originalZValues.map((row, rowIndex) =>
                        row.map((value, colIndex) => {
                            if (ignoreDiagonals && rowIndex === colIndex) return NaN;
                            return value === 0 ? 0 : Math.tanh(Math.abs(value)) * Math.sign(value);
                        })
                    );
                }

                function updatePlot(ignoreDiagonals) {
                    zValues = getZValues(ignoreDiagonals);
                    Plotly.react('plot', [{
                        z: zValues,
                        x: xLabels,
                        y: yLabels,
                        type: 'heatmap',
                        colorscale: colorscale,
                        text: textValues,
                        texttemplate: '%{text}',
                        hoverinfo: 'x+y',
                        xgap: 2.5, // x축 여백 추가
                        ygap: 2.5, // y축 여백 추가
                        colorbar: { showscale: false } // 색깔 레전드 숨기기
                    }], {
                        paper_bgcolor: backgroundColor,
                        plot_bgcolor: backgroundColor,
                        font: { color: axisColor },
                        xaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor },
                        yaxis: { showticklabels: true, tickangle: -45, gridcolor: gridColor },
                        annotations: annotations,
                        title: '${fileName}' // 파일 이름으로 타이틀 설정
                    }, { responsive: true });
                }

                updatePlot(ignoreDiagonals);
            </script>
        </body>
        </html>
    `;
}
function getWebviewContent_table(data: any[], theme: string): string {
    const tablesHtml = data.map(({ tableNoLine, firstRow, lastRow, sparklineData, header, extendedRows }, tableIndex) => {
        const columns = header;

        const getMetricColor = (metric: string): string | null => {
            const colors: { [key: string]: string } = {
                'THETA': '#6699cc',
                'OMEGA': '#66cc99',
                'SIGMA': '#ff6666'
            };
            return Object.keys(colors).find(key => metric.includes(key)) ? colors[Object.keys(colors).find(key => metric.includes(key))!] : null;
        };

        const getBarColor = (value: number): string => {
            // ✅ 원하는 색상 설정 (RGB)
            const minColor = [51, 153, 204];  // ✅ #3399CC (부드러운 블루)
            const midColor = [102, 204, 102]; // ✅ #66CC66 (초록)
            const maxColor = [255, 102, 102]; // ✅ #FF6666 (레드)
        
            // ✅ 값이 100%를 초과하는 경우 제한 (최대 150%)
            value = Math.max(-150, Math.min(150, value));
        
            let ratio: number;
            let r, g, b;
        
            if (value < 0) {
                // ✅ -100 ~ 0 → minColor → midColor 보간
                ratio = Math.max(0, (value + 100) / 100);
                r = Math.round(minColor[0] * (1 - ratio) + midColor[0] * ratio);
                g = Math.round(minColor[1] * (1 - ratio) + midColor[1] * ratio);
                b = Math.round(minColor[2] * (1 - ratio) + midColor[2] * ratio);
            } else {
                // ✅ 0 ~ 100 → midColor → maxColor 보간
                ratio = Math.min(1, value / 100);
                r = Math.round(midColor[0] * (1 - ratio) + maxColor[0] * ratio);
                g = Math.round(midColor[1] * (1 - ratio) + maxColor[1] * ratio);
                b = Math.round(midColor[2] * (1 - ratio) + maxColor[2] * ratio);
            }
        
            return `rgba(${r}, ${g}, ${b}, 0.5)`; // ✅ RGB 색상 적용 (투명도 0.6)
        };
        
        const getHeaderForValue = (value: number): string => {
            switch (value) {
                case -1000000000: return 'Final'; // Not used
                case -1000000001: return 'SE';
                case -1000000002: return 'Eig Cor';
                case -1000000003: return 'Cond';
                case -1000000004: return 'SD/Cor';
                case -1000000005: return 'SeSD/Cor';
                case -1000000006: return 'Fixed';
                case -1000000007: return 'Term';
                case -1000000008: return 'ParLik';
                default: return value.toString(); // ✅ 숫자는 그대로 반환
            }
        };

        const formatNumber = (num: number) => {
            if (num === 0) { return ''; } // Hide 0 values
            if (Math.abs(num) >= 1) { return num.toFixed(2); }
            const str = num.toPrecision(3);
            if (str.includes('e')) {
                const [base, exp] = str.split('e');
                const adjustedExp = parseInt(exp, 10) + 2;
                return parseFloat(base).toFixed(5 - adjustedExp);
            }
            return str;
        };

        const filteredExtendedRows = extendedRows.filter((row: { [x: string]: number; }) =>
            row['ITERATION'] !== -1000000006 &&
            row['ITERATION'] !== -1000000007 &&
            row['ITERATION'] !== -1000000000 // Final value will be processed in data level
        );

        const headerDescriptions: { [key: string]: string } = {
            "Parameter": "Model parameters",
            "Initial": "Initial Estimate",
            "Final": "Final Estimate",
            "Difference (%)": "Difference between initial-final, % changes in brackets",
            "RSE": "Relative Standard Error: Standard error / Final estimate",
            "SE": "Standard Error",
            "Eig Cor": "Eigenvalue Correlation",
            "Cond": "Condition Number: identifies the line that contains the condition number, lowest, highest, Eigenvalues of the correlation matrix of the variances of the final parameters.",
            "SD/Cor": "identifies the line that contains the OMEGA and SIGMA elements in standard deviation/correlation format",
            "SeSD/Cor": "identifies the line that contains the standard errors to the OMEGA and SIGMA elements in standard deviation/correlation format",
            "Fixed": "identifies the line that contains the standard errors to the OMEGA and SIGMA elements in standard deviation/correlation format",
            "Term": "lists termination status",
            "ParLik": "lists the partial derivative of the likelihood (-1/2 OFV) with respect to each estimated parameter. This may be useful for using tests like the Lagrange multiplier test"
        };

        // Check SE column
const hasStdErr = filteredExtendedRows.some((row: { [x: string]: number; }) => getHeaderForValue(row['ITERATION']) === "SE");

const tableHeader = `
    <tr>
        ${["Parameter", "Initial", "Final", "Difference (%)"]
            .map(header => `<th data-tooltip="${headerDescriptions[header] || 'No description'}">${header}</th>`)
            .join('')}
        ${hasStdErr ? `<th data-tooltip="${headerDescriptions["RSE"] || 'No description'}">RSE</th>` : ''} <!-- ✅ SE가 있을 때만 RSE 추가 -->
        ${filteredExtendedRows.map((row: { [x: string]: number; }) => {
            const header = getHeaderForValue(row['ITERATION']);
            return `<th data-tooltip="${headerDescriptions[header] || 'No description'}">${header}</th>`;
        }).join('')}
    </tr>
`;
const tableRows = columns.map((col: string, index: number) => {
    const firstValue = firstRow[col];
    const lastValue = lastRow[col];
    const stdErrRow = hasStdErr ? filteredExtendedRows.find((row: { [x: string]: number; }) => getHeaderForValue(row['ITERATION']) === "SE") : null;
    const stdErrValue = stdErrRow ? stdErrRow[col] : null;

    const diff = lastValue - firstValue;
    const change = (index !== 0 && index !== columns.length - 1 && firstValue !== 0) ? (diff / firstValue) * 100 : null;
    const metricColor = getMetricColor(col);

    const fixedColumn = extendedRows.find((row: { [x: string]: number; }) => row['ITERATION'] === -1000000006);
    const isFixed = fixedColumn && fixedColumn[col] === 1;
    const rowStyle = isFixed ? 'background-color: rgba(128, 128, 128, 0.1);' : '';

    // ✅ `Std Err` 컬럼이 있는 경우만 `RSE` 계산
    const rseValue = (hasStdErr && index !== 0 && index !== columns.length - 1 && !isFixed && stdErrValue !== null && lastValue !== 0) 
        ? (stdErrValue / lastValue) * 100 
        : null;

    let differenceDisplay = (!isFixed && index !== 0 && index !== columns.length - 1) 
        ? `${formatNumber(diff)} (${change !== null ? formatNumber(change) + '%' : ''})`
        : '';

    let gradientBackground = '';
    if (!isFixed && index !== 0 && index !== columns.length - 1 && change !== null) {
        let gradientPosition = Math.min(Math.max(50 + (change * 0.4), 10), 90);
        let gradientWidth = Math.min(Math.abs(change) * 0.5 + 10, 50); // ✅ Difference 크기에 따라 가변 설정
        
        gradientBackground = `
            background: linear-gradient(to right, 
                transparent ${gradientPosition - gradientWidth}%, 
                ${getBarColor(change)} ${gradientPosition}%, 
                transparent ${gradientPosition + gradientWidth}%
            );
        `;
    }

    const extendedRowValues = filteredExtendedRows.map((row: { [x: string]: number; }) => {
        const value = row[col];
        const isStdErr = getHeaderForValue(row['ITERATION']) === "SE"; // ✅ SE 컬럼인지 확인
    
        return isNaN(value) || value === Infinity || value <= -1000000000 || value === 0 || value === 10000000000.00
            ? '<td></td>'
            : `<td style="${isStdErr ? 'color: gray;' : ''}">${formatNumber(value)}</td>`; // ✅ SE 컬럼이면 텍스트 회색
    }).join('');
    return `
        <tr class="data-row" data-metric="${col}" style="${rowStyle}">
            <td style="font-weight: bold; ${metricColor ? `color: ${metricColor};` : ''}">${col}</td>
            <td style="color: gray;">${formatNumber(firstValue)}</td>
            <td>${formatNumber(lastValue)}</td>
            <td style="position: relative; padding: 5px; ${isFixed ? '' : gradientBackground}">
                <span style="position: relative; z-index: 1;">
                    ${differenceDisplay}
                </span>
            </td>
            ${hasStdErr ? `<td>${rseValue !== null ? formatNumber(rseValue) + "%" : ""}</td>` : ''} <!-- ✅ RSE 값도 조건부 추가 -->
            ${extendedRowValues}
        </tr>
    `;
}).join('');

        return `
    <table>
        <style>
            table {
                width: auto;
                border-collapse: collapse;
                table-layout: fixed;
            }
            th, td {
                padding: 5px;
                border: 1px solid rgba(0, 0, 0, 0.1);
                white-space: nowrap;
            }
            th {
                background-color: rgba(255, 255, 255, 0.05);
                text-align: center; /* ✅ 헤더 가운데 정렬 */
                position: relative;
            }

            /* ✅ 즉시 뜨는 커스텀 툴팁 스타일 */
            th:hover::after {
                content: attr(data-tooltip);
                position: fixed; /* ✅ 컬럼 크기와 무관하게 위치 고정 */
                left: auto; /* ✅ 위치 자동 조정 */
                top: auto;
                background-color: rgba(0, 0, 0, 0.75);
                color: white;
                padding: 5px 8px;
                border-radius: 4px;
                font-size: 12px;
                max-width: 200px; /* ✅ 최대 너비 설정 */
                width: auto; /* ✅ 내용에 맞춰 너비 조정 */
                display: inline-block; /* ✅ 크기 자동 조정 */
                word-wrap: break-word; /* ✅ 긴 텍스트 줄 바꿈 */
                white-space: normal; /* ✅ 여러 줄 지원 */
                text-align: left; /* ✅ 툴팁 내부 글자 왼쪽 정렬 */
                z-index: 1000;
                opacity: 1;
                transition: none;
            }
        </style>
        <h4>Table NO. ${tableNoLine}</h4> <!-- ✅ Table NO. 표시 추가 -->
        ${tableHeader}
        ${tableRows}
    </table>
`;


    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { margin: 0; padding: 20px 0 0 20px; font-family: Arial, sans-serif; }
                table { width: auto; border-collapse: collapse; table-layout: fixed; margin-bottom: 20px; }
                th, td { padding: 2px 5px; text-align: left; border: 1px solid rgba(0, 0, 0, 0.1); white-space: nowrap; }
                th { background-color: transparent; }
                .bar-container { display: flex; align-items: center; }
                .bar { height: 10px; margin-right: 5px; }
                svg { width: 100%; height: 20px; }
            </style>
        </head>
        <body>
            <button id="toggle-filter">Off-diagonal</button>
            <br><br>
            ${tablesHtml}
            <script>
                document.getElementById('toggle-filter').addEventListener('click', function() {
                    const rows = document.querySelectorAll('.data-row');
                    rows.forEach(function(row) {
                        const metric = row.getAttribute('data-metric');
                        if (metric && (metric.includes('OMEGA') || metric.includes('SIGMA'))) {
                            const regex = /(\\d+),(\\d+)/;
                            const match = metric.match(regex);
                            if (match && match[1] !== match[2]) {
                                row.style.display = row.style.display === 'none' ? '' : 'none';
                            }
                        }
                    });
                });

                window.addEventListener('DOMContentLoaded', function() {
                    const rows = document.querySelectorAll('.data-row');
                    rows.forEach(function(row) {
                        const metric = row.getAttribute('data-metric');
                        if (metric && (metric.includes('OMEGA') || metric.includes('SIGMA'))) {
                            const regex = /(\\d+),(\\d+)/;
                            const match = metric.match(regex);
                            if (match && match[1] !== match[2]) {
                                row.style.display = 'none';
                            }
                        }
                    });


                });
            </script>
        </body>
        </html>
    `;
}

export function deactivate() { }