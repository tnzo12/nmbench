import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as childProcess from 'child_process';
import { showModFileContextMenu } from './commands';
import { showModFileContextMenuNONMEM } from './commands';
import { showRScriptCommand } from './commands';

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

    getChildren(element?: ModFile | ModFolder): Thenable<(ModFile | ModFolder)[]> {
        if (!element) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return Promise.resolve([]);
            }
            return Promise.resolve(workspaceFolders.map(folder => new ModFolder(folder.uri)));
        } else if (element instanceof ModFolder) {
            return new Promise(resolve => {
                fs.readdir(element.uri.fsPath, (err, files) => {
                    if (err) {
                        resolve([]);
                    } else {
                        const folders: ModFolder[] = [];
                        const modFiles: ModFile[] = [];
                        files.forEach(file => {
                            const filePath = path.join(element.uri.fsPath, file);
                            const stat = fs.statSync(filePath);
                            if (stat.isDirectory()) {
                                folders.push(new ModFolder(vscode.Uri.file(filePath)));
                            } else if (file.match(/\.(mod|ctl)$/)) {
                                modFiles.push(new ModFile(vscode.Uri.file(filePath)));
                            }
                        });
                        resolve([...folders, ...modFiles]);
                    }
                });
            });
        } else {
            return Promise.resolve([]);
        }
    }

    async getModFileOrFolder(uri: vscode.Uri): Promise<ModFile | ModFolder | undefined> {
        const stack: (ModFile | ModFolder)[] = [];

        const addChildrenToStack = async (element?: ModFile | ModFolder) => {
            const children = await this.getChildren(element);
            stack.push(...children);
        };

        await addChildrenToStack();

        while (stack.length) {
            const current = stack.pop();
            if (!current) { continue; }
            if (current.uri.fsPath === uri.fsPath) { return current; }
            if (current instanceof ModFolder) { await addChildrenToStack(current); }
        }

        return undefined;
    }

    getParent(element: ModFile | ModFolder): vscode.ProviderResult<ModFile | ModFolder> {
        const parentUri = path.dirname(element.uri.fsPath);
        if (parentUri === element.uri.fsPath) {
            return null;
        }
        const parentElement = new ModFolder(vscode.Uri.file(parentUri));
        return parentElement;
    }
}

class ModFile extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath));
        const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
        this.tooltip = this.extractDescription(fileContent) || uri.fsPath;
        this.contextValue = 'modFile';
    }

    private extractDescription(content: string): string | null {
        const descriptionRegex = /.*Description:\s*(.*)/i;
        const match = content.match(descriptionRegex);
        return match ? match[1] : null;
    }
}

class ModFolder extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = uri.fsPath;
        this.contextValue = 'modFolder';
    }

    iconPath = {
        light: path.join(__filename, '..', '..', 'resources', 'light', 'folder.svg'),
        dark: path.join(__filename, '..', '..', 'resources', 'dark', 'folder.svg')
    };
}

export function activate(context: vscode.ExtensionContext) {
    const modFileViewerProvider = new ModFileViewerProvider();
    const treeView = vscode.window.createTreeView('modFileViewer', {
        treeDataProvider: modFileViewerProvider,
        canSelectMany: true
    });

    let openModFileDisposable = vscode.commands.registerCommand('extension.openModFile', (uri: vscode.Uri) => {
        vscode.workspace.openTextDocument(uri).then(doc => {
            vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
        });
    });
    context.subscriptions.push(openModFileDisposable);

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

    let refreshCommandDisposable = vscode.commands.registerCommand('extension.refreshModFileViewer', () => {
        modFileViewerProvider.refresh();
    });
    context.subscriptions.push(refreshCommandDisposable);

    let showModFileContextMenuDisposable = vscode.commands.registerCommand('extension.showModFileContextMenu', (uri: vscode.Uri) => {
        showModFileContextMenu([uri]);
    });
    context.subscriptions.push(showModFileContextMenuDisposable);

    let showModFileContextMenuFromTreeViewDisposable = vscode.commands.registerCommand('extension.showModFileContextMenuFromTreeView', () => {
        const selectedNodes = treeView.selection as (ModFile | ModFolder)[];

        if (!selectedNodes || selectedNodes.length === 0) {
            vscode.window.showInformationMessage('No items selected.');
            return;
        }

        selectedNodes.forEach(node => {
            console.log(`Selected node URI: ${node.uri.fsPath}`);
        });

        showModFileContextMenu(selectedNodes);
    });
    context.subscriptions.push(showModFileContextMenuFromTreeViewDisposable);

    let showModFileContextMenuNONMEMDisposable = vscode.commands.registerCommand('extension.showModFileContextMenuNONMEM', (uri: vscode.Uri) => {
        showModFileContextMenuNONMEM([uri], context);
    });
    context.subscriptions.push(showModFileContextMenuNONMEMDisposable);

    let showSumoCommandDisposable = vscode.commands.registerCommand('extension.showSumoCommand', () => {
        const selectedNodes = treeView.selection;
        if (selectedNodes.length === 0) {
            vscode.window.showInformationMessage('No items selected.');
            return;
        }
    
        const lstFilePaths = selectedNodes.map(node => node.uri.fsPath.replace(/\.[^.]+$/, '.lst')); // mod 확장자를 lst로 변경
    
        // 현재 파일의 디렉토리로 작업 디렉토리 변경
        const options = {
            cwd: path.dirname(selectedNodes[0].uri.fsPath)
        };
    
        lstFilePaths.forEach(lstFilePath => {
            if (!fs.existsSync(lstFilePath)) {
                vscode.window.showErrorMessage(`File ${path.basename(lstFilePath)} does not exist.`);
                return;
            }
        });
    
        vscode.window.showInputBox({
            prompt: 'Enter parameters for Sumo command:',
            value: `sumo ${lstFilePaths.map(filePath => path.basename(filePath)).join(' ')}`
        }).then(input => {
            if (input) {
                const outputFileNames = lstFilePaths.map(filePath => `${path.basename(filePath, path.extname(filePath))}_sumo.txt`);
                const outputFilePaths = outputFileNames.map(fileName => path.join(path.dirname(lstFilePaths[0]), fileName));
                const commands = outputFilePaths.map((outputFilePath, index) => `${input} > ${outputFilePath} 2>&1`);
    
                commands.forEach((command, index) => {
                    childProcess.exec(command, options, (error, stdout, stderr) => {
                        if (error) {
                            vscode.window.showErrorMessage(`Error executing command: ${stderr}`);
                            return;
                        }
    
                        // Read the output file and show it in a WebView
                        fs.readFile(outputFilePaths[index], 'utf-8', (err, data) => {
                            if (err) {
                                vscode.window.showErrorMessage(`Error reading output file: ${err.message}`);
                                return;
                            }
    
                            const panel = vscode.window.createWebviewPanel(
                                'sumoOutput',
                                outputFileNames[index],
                                vscode.ViewColumn.One,
                                {}
                            );
    
                            panel.webview.html = getWebviewContent(data);
                        });
                    });
                });
            }
        });
    });
    context.subscriptions.push(showSumoCommandDisposable);


    let manageRScriptCommandDisposable = vscode.commands.registerCommand('extension.manageRScriptCommand', (node: ModFile | ModFolder) => {
        const scriptsFolder = path.join(context.extensionPath, 'Rscripts');
        if (!fs.existsSync(scriptsFolder)) {
            fs.mkdirSync(scriptsFolder);
        }

        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(scriptsFolder), true);
    });
    context.subscriptions.push(manageRScriptCommandDisposable);

    let showRScriptCommandFromTreeViewDisposable = vscode.commands.registerCommand('extension.showRScriptCommandFromTreeView', () => {
        const selectedNodes = treeView.selection as (ModFile | ModFolder)[];
        if (!selectedNodes || selectedNodes.length === 0) {
            vscode.window.showInformationMessage('No items selected??.');
            return;
        }
        showRScriptCommand(context, selectedNodes);



        

    });
    context.subscriptions.push(showRScriptCommandFromTreeViewDisposable);

    let showRScriptCommandFromEditorDisposable = vscode.commands.registerCommand('extension.showRScriptCommandFromEditor', (uri: vscode.Uri) => {
        showRScriptCommand(context, [uri]);
    });
    context.subscriptions.push(showRScriptCommandFromEditorDisposable);

    let showLinkedFilesDisposable = vscode.commands.registerCommand('extension.showLinkedFiles', (node: ModFile) => {
        const dir = path.dirname(node.uri.fsPath);
        const baseName = path.basename(node.uri.fsPath, path.extname(node.uri.fsPath));

        fs.readdir(dir, (err, files) => {
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

            if (linkedFiles.length === 0) {
                vscode.window.showInformationMessage('No linked files found.');
                return;
            }

            vscode.window.showQuickPick(linkedFiles).then(selected => {
                if (selected) {
                    vscode.workspace.openTextDocument(vscode.Uri.file(selected.description!)).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        });
    });
    context.subscriptions.push(showLinkedFilesDisposable);
    
    let showHeatmapDisposable = vscode.commands.registerCommand('extension.showHeatmap', function () {
        const editor = vscode.window.activeTextEditor;

        if (editor) {
            const content = editor.document.getText();
            const tables = parseTables(content);

            const panel = vscode.window.createWebviewPanel(
                'heatmapViewer',
                'Heatmap Viewer',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent_heatmap(tables);
        } else {
            vscode.window.showErrorMessage('No active editor found. Please open a file first.');
        }
    });

    context.subscriptions.push(showHeatmapDisposable);
}

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

function parseTables(content: string) {
    const tables = content.split(/TABLE\s/).filter((section: string) => section.trim() !== '');
    return tables.map((table: string) => {
        const rows = table.trim().split('\n');
        return rows.map((row: string) => row.trim().split(/\s+/).map(cell => parseFloat(cell) || cell));
    });
}

function getWebviewContent_heatmap(tables: any[]) {
    // Find the maximum and minimum values for off-diagonal elements
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    tables.forEach(table => {
        table.forEach((row: any[], rowIndex: any) => {
            row.forEach((cell, colIndex) => {
                if (rowIndex-1 !== colIndex) { // Off-diagonal element
                    if (!isNaN(cell)) {
                        min = Math.min(min, cell);
                        max = Math.max(max, cell);
                    }
                }
            });
        });
    });

    // Convert tables to HTML table format
    const tablesHTML = tables.map(table => {
        const rowsHTML = table.map((row: any[], rowIndex: any) => {
            if (rowIndex === 0) {return '';} // Skip the first row
            const cellsHTML = row.map((cell, colIndex) => {
                const isOffDiagonal = rowIndex-1 !== colIndex;
                const cellStyle = isOffDiagonal ? `style="background-color: ${getColor(cell, min, max)}"` : '';
                return `<td ${cellStyle}>${cell}</td>`;
            }).join('');
            return `<tr>${cellsHTML}</tr>`;
        }).join('');
        return `<table>${rowsHTML}</table>`;
    }).join('<br><br>');

    // HTML template with monospaced font
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Heatmap Viewer</title>
            <style>
                body {
                    font-family: monospace;
                }
                table {
                    border-collapse: separate;
                    margin-bottom: 10px;
                    font-size: smaller;
                }
                td {
                    border-radius: 3px;
                    border: 1px;
                    padding: 3px;
                }
            </style>
        </head>
        <body>
            ${tablesHTML}
        </body>
        </html>`;
}
function getColor(value: number, min: number, max: number): string {
    
    const range = Math.max(Math.abs(min), Math.abs(max)); // select the largest val.
    const normalizedValue = value/range;

    const hue = 120 * (1 - normalizedValue);

    if (normalizedValue === 0) {
        return `hsl(0, 0%, 60%, 30%)`;
    }

    return `hsl(${hue}, 100%, 50%, 60%)`;
}

export function deactivate() {}
