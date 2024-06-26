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
            if (!workspaceFolders) {return [];}
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
        if (parentUri === element.uri.fsPath) {return null;}
        return new ModFolder(vscode.Uri.file(parentUri));
    }
}

class ModFile extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri) {
        super(path.basename(uri.fsPath));
        const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
        this.tooltip = this.extractDescription(fileContent) || uri.fsPath;
        this.contextValue = 'modFile';

        const statuses = this.getStatuses();
        this.tooltip = statuses.map(status => status.text).join(' ');
        this.description = statuses.filter(status => status.code !== '✔️' && status.code !== '❌').map(status => status.code).join(' ');

        if (statuses.length > 0) {
            this.iconPath = this.getStatusIconPath(statuses[0].text);
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
        }

        const objectiveFunctionValue = this.getObjectiveFunctionValue();
        if (objectiveFunctionValue) {
            this.description += ` ${objectiveFunctionValue}`;
        }
    }

    private extractDescription(content: string): string | null {
        const descriptionRegex = /.*Description:\s*(.*)/i;
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
        if (content.includes('MINIMIZATION SUCCESSFUL')) {
            statuses.push({ text: 'Minimization Successful', code: 'S' });
        }
        if (content.includes('TERMINATED')) {
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
        vscode.commands.registerCommand('extension.showModFileContextMenuFromTreeView', () => {
            const selectedNodes = treeView.selection as (ModFile | ModFolder)[];
            if (!selectedNodes || selectedNodes.length === 0) {
                vscode.window.showInformationMessage('No items selected.');
                return;
            }
            showModFileContextMenu(selectedNodes);
        }),
        vscode.commands.registerCommand('extension.showModFileContextMenuNONMEM', (uri: vscode.Uri) => {
            showModFileContextMenuNONMEM([uri], context);
        }),
        vscode.commands.registerCommand('extension.showSumoCommand', () => {
            const selectedNodes = treeView.selection;
            if (selectedNodes.length === 0) {
                vscode.window.showInformationMessage('No items selected.');
                return;
            }

            const lstFilePaths = selectedNodes.map(node => node.uri.fsPath.replace(/\.[^.]+$/, '.lst'));

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
                    const outputFileName = selectedNodes.length > 1 ? 'sumo_compare.txt' : `${path.basename(lstFilePaths[0], path.extname(lstFilePaths[0]))}_sumo.txt`;
                    const outputFilePath = path.join(path.dirname(lstFilePaths[0]), outputFileName);
                    const command = `${input} > ${outputFilePath} 2>&1`;

                    childProcess.exec(command, options, (error, stdout, stderr) => {
                        if (error) {
                            vscode.window.showErrorMessage(`Error executing command: ${stderr}`);
                            return;
                        }

                        fs.readFile(outputFilePath, 'utf-8', (err, data) => {
                            if (err) {
                                vscode.window.showErrorMessage(`Error reading output file: ${err.message}`);
                                return;
                            }

                            const panel = vscode.window.createWebviewPanel(
                                'sumoOutput',
                                outputFileName,
                                vscode.ViewColumn.One,
                                {}
                            );

                            panel.webview.html = getWebviewContent(data);
                        });
                    });
                }
            });
        }),
        vscode.commands.registerCommand('extension.manageRScriptCommand', (node: ModFile | ModFolder) => {
            const scriptsFolder = path.join(context.extensionPath, 'Rscripts');
            if (!fs.existsSync(scriptsFolder)) {
                fs.mkdirSync(scriptsFolder);
            }

            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(scriptsFolder), true);
        }),
        vscode.commands.registerCommand('extension.showRScriptCommandFromTreeView', () => {
            const selectedNodes = treeView.selection as (ModFile | ModFolder)[];
            if (!selectedNodes || selectedNodes.length === 0) {
                vscode.window.showInformationMessage('No items selected.');
                return;
            }
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
                if (!document) {
                    vscode.window.showErrorMessage('No file selected.');
                    return;
                }
                
                const uri = document.uri;
                if (!uri.fsPath.match(/\.(mod|ctl)$/)) {
                    vscode.window.showErrorMessage('The active file is not a MOD or CTL file.');
                    return;
                }
                
                node = new ModFile(uri);
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
                    if (message.command === "updatePlot") {
                        panel.webview.postMessage({ command: "plotData", data: data, config: message.config });
                    }
                });
            }
        }),
        vscode.commands.registerCommand('extension.readExtFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileName = document.fileName;
                if (fileName.endsWith('.ext')) {
                    const data = await readNmTable_ext(fileName);
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
                        if (message.command === "updateTable") {
                            panel.webview.postMessage({ command: "tableData", data: data, config: message.config });
                        }
                    });
                } else {
                    vscode.window.showErrorMessage('The active file is not an EXT file.');
                }
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

                //if (fileName.match(/sdtab\d*|patab\d*/)) {
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
                        if (message.command === "updatePlot") {
                            panel.webview.postMessage({ command: "plotData", data: data, config: message.config });
                        }
                    });
                //}
            }
        })
    );

    vscode.commands.registerCommand('extension.showHistogram', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const fileName = document.fileName;
    
            //if (fileName.match(/sdtab\d*|patab\d*/)) {
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
            //}
        }
    });
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

                // Filter rows where ITERATION is greater than -1000000000
                const filteredRows = rows.filter(row => (row['ITERATION'] as number) > -1000000000);

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

                return { tableNoLine, firstRow, lastRow, sparklineData, header };
            }).filter(table => table !== null);

            resolve(tables);
        });
    });
}



function generateSparkline(data: number[]): string {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min;
    return data.map((value, index) => {
        const x = (index / (data.length - 1)) * 100;
        const y = ((value - min) / range) * 100;
        return `${x},${100 - y}`;
    }).join(' ');
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

function getWebviewContent_hist(data: any[], theme: string) {
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
            if (ignoreDiagonals && rowIndex === colIndex) {return NaN;} // 대각선 요소는 NaN으로 설정하여 색상 제거
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
    const tablesHtml = data.map(({ tableNoLine, firstRow, lastRow, sparklineData, header }, tableIndex) => {
        const columns = header;

        const difference = columns.map((col: string | number) => {
            if (typeof firstRow[col] === 'number' && typeof lastRow[col] === 'number') {
                return (lastRow[col] as number) - (firstRow[col] as number);
            }
            return null;
        });

        const changeInPercent = columns.map((col: string | number) => {
            if (typeof firstRow[col] === 'number' && typeof lastRow[col] === 'number') {
                const diff = (lastRow[col] as number) - (firstRow[col] as number);
                return (diff / (firstRow[col] as number)) * 100;
            }
            return null;
        });

        const getMetricColor = (metric: string): string | null => {
            if (metric.includes('THETA')) {return '#6699cc';}
            if (metric.includes('OMEGA')) {return '#66cc99';}
            if (metric.includes('SIGMA')) {return '#ff6666';}
            return null;
        };

        const getBarColor = (value: number): string => {
            if (value <= -25) {
                const ratio = (value + 100) / 75; // -100 to -25
                const r = Math.round(ratio * 102);
                return `rgba(${r}, 153, 204, 0.8)`; // Blue to yellow
            } else if (value >= 25) {
                const ratio = (value - 25) / 75; // 25 to 100
                const b = Math.round((1 - ratio) * 102);
                return `rgba(255, 102, ${b}, 0.8)`; // Yellow to red
            } else {
                return 'rgba(255, 204, 0, 0.8)'; // Yellow
            }
        };

        const tableHeader = `
            <tr>
                <th>Metric</th>
                <th>Value (ini-est)</th>
                <th>Trend</th>
                <th>Difference</th>
                <th>Change in %</th>
            </tr>
        `;

        const tableRows = columns.map((col: string, index: string | number) => {
            const diff = difference[index];
            const change = changeInPercent[index];
            const metricColor = getMetricColor(col);
            const barWidth = Math.min(Math.abs(change ?? 0), 100);
            const barColor = change !== null ? getBarColor(change) : 'transparent';
            const barPosition = change !== null ? (change >= 0 ? 'right' : 'left') : 'transparent';
            const isOffDiagonal = col.includes('OMEGA') || col.includes('SIGMA');
            const shouldHide = isOffDiagonal && col.match(/(\d+),(\d+)/) && col.match(/(\d+),(\d+)/)![1] !== col.match(/(\d+),(\d+)/)![2];
            const sparklineArray = sparklineData[col] ? sparklineData[col].join(',') : '';
            return `
                <tr class="data-row" data-metric="${col}" style="${shouldHide ? 'display: none;' : ''}">
                    <td ${metricColor ? `style="color: ${metricColor}"` : ''}>${col}</td>
                    <td>
                        ${typeof firstRow[col] === 'number' ? (firstRow[col] as number).toFixed(2) : firstRow[col]}
                        -
                        ${typeof lastRow[col] === 'number' ? (lastRow[col] as number).toFixed(2) : lastRow[col]}
                    </td>
                    <td>${sparklineArray ? '<span class="sparkline" data-values="' + sparklineArray + '"></span>' : ''}</td>
                    <td>${diff !== null ? diff.toFixed(2) : ''}</td>
                    <td>
                        <div class="bar-container">
                            <div class="bar" style="background-color: ${barColor}; width: ${barWidth}%; float: ${barPosition};"></div>
                            <span>${change !== null ? change.toFixed(2) + '%' : ''}</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <h2>${tableNoLine}</h2>
            <table>
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
                th, td { padding: 2px 5px; text-align: left; border: 1px solid rgba(0, 0, 0, 0.2); white-space: nowrap; }
                th { background-color: transparent; }
                .bar-container { display: flex; align-items: center; }
                .bar { height: 10px; margin-right: 5px; }
                .sparkline { display: inline-block; width: 100%; height: 20px; }
                svg { width: 100%; height: 20px; }
            </style>
        </head>
        <body>
            <button id="toggle-filter">Off-diagonal</button>
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

                    const sparklines = document.querySelectorAll('.sparkline');
                    sparklines.forEach(function(span) {
                        const values = span.getAttribute('data-values').split(',').map(Number);
                        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                        svg.setAttribute('viewBox', '0 0 100 100');
                        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                        const max = Math.max(...values);
                        const min = Math.min(...values);
                        const range = max - min;
                        const points = values.map(function(value, index) {
                            const x = (index / (values.length - 1)) * 100;
                            const y = ((value - min) / range) * 100;
                            return x + ',' + (100 - y);
                        }).join(' ');
                        polyline.setAttribute('points', points);
                        polyline.setAttribute('fill', 'none');
                        polyline.setAttribute('stroke', '#FF6666');
                        polyline.setAttribute('stroke-width', '2');
                        svg.appendChild(polyline);
                        span.appendChild(svg);
                    });
                });
            </script>
        </body>
        </html>
    `;
}

export function deactivate() {}