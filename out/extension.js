"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const util = __importStar(require("util"));
const childProcess = __importStar(require("child_process"));
const commands_1 = require("./commands");
const readFile = util.promisify(fs.readFile);
class ModFileViewerProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    refresh(element) {
        this._onDidChangeTreeData.fire(element);
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return [];
            }
            return workspaceFolders.map(folder => new ModFolder(folder.uri));
        }
        else if (element instanceof ModFolder) {
            try {
                const files = await fs.promises.readdir(element.uri.fsPath);
                const folders = [];
                const modFiles = [];
                for (const file of files) {
                    const filePath = path.join(element.uri.fsPath, file);
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isDirectory()) {
                        folders.push(new ModFolder(vscode.Uri.file(filePath)));
                    }
                    else if (file.match(/\.(mod|ctl)$/)) {
                        const modFile = new ModFile(vscode.Uri.file(filePath));
                        await modFile.checkTerminal();
                        modFiles.push(modFile);
                    }
                }
                return [...folders, ...modFiles];
            }
            catch (err) {
                console.error('Failed to read directory:', err);
                return [];
            }
        }
        else {
            return [];
        }
    }
    async getModFileOrFolder(uri) {
        const currentDir = path.dirname(uri.fsPath);
        const files = await fs.promises.readdir(currentDir);
        const children = await Promise.all(files.map(async (file) => {
            const filePath = path.join(currentDir, file);
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
                return new ModFolder(vscode.Uri.file(filePath));
            }
            else if (file.match(/\.(mod|ctl)$/)) {
                const modFile = new ModFile(vscode.Uri.file(filePath));
                await modFile.checkTerminal();
                return modFile;
            }
        }));
        return children.find(child => child?.uri.fsPath === uri.fsPath);
    }
    getParent(element) {
        const parentUri = path.dirname(element.uri.fsPath);
        if (parentUri === element.uri.fsPath) {
            return null;
        }
        return new ModFolder(vscode.Uri.file(parentUri));
    }
}
class ModFile extends vscode.TreeItem {
    uri;
    constructor(uri) {
        super(path.basename(uri.fsPath));
        this.uri = uri;
        const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
        this.tooltip = this.extractDescription(fileContent) || uri.fsPath;
        this.contextValue = 'modFile';
        const statuses = this.getStatuses();
        this.tooltip = statuses.map(status => status.text).join(' ');
        this.description = statuses.filter(status => status.code !== '✔️' && status.code !== '❌').map(status => status.code).join(' ');
        if (statuses.length > 0) {
            this.iconPath = this.getStatusIconPath(statuses[0].text);
        }
        else {
            this.iconPath = new vscode.ThemeIcon('file');
        }
        const objectiveFunctionValue = this.getObjectiveFunctionValue();
        if (objectiveFunctionValue) {
            this.description += ` ${objectiveFunctionValue}`;
        }
    }
    extractDescription(content) {
        const descriptionRegex = /.*Description:\s*(.*)/i;
        const match = content.match(descriptionRegex);
        return match ? match[1] : null;
    }
    getStatuses() {
        const lstFilePath = this.uri.fsPath.replace(/\.[^.]+$/, '.lst');
        if (!fs.existsSync(lstFilePath)) {
            return [];
        }
        const content = fs.readFileSync(lstFilePath, 'utf-8');
        const statuses = [];
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
        }
        else if (covarianceStep) {
            statuses.push({ text: 'w Covariance Step done', code: 'C' });
        }
        return statuses;
    }
    getStatusIconPath(statusText) {
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
    getObjectiveFunctionValue() {
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
    uri;
    constructor(uri) {
        super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
        this.uri = uri;
        this.tooltip = uri.fsPath;
        this.contextValue = 'modFolder';
        this.iconPath = {
            light: path.join(__filename, '..', '..', 'resources', 'light', 'folder.svg'),
            dark: path.join(__filename, '..', '..', 'resources', 'dark', 'folder.svg')
        };
    }
}
function activate(context) {
    const modFileViewerProvider = new ModFileViewerProvider();
    const treeView = vscode.window.createTreeView('modFileViewer', {
        treeDataProvider: modFileViewerProvider,
        canSelectMany: true // 전체 트리에 다중 선택 허용
    });
    context.subscriptions.push(vscode.commands.registerCommand('extension.openModFile', (uri) => {
        vscode.workspace.openTextDocument(uri).then(doc => {
            vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
        });
    }), vscode.commands.registerCommand('extension.refreshModFileViewer', () => {
        modFileViewerProvider.refresh();
    }), vscode.commands.registerCommand('extension.showModFileContextMenu', (uri) => {
        (0, commands_1.showModFileContextMenu)([uri]);
    }), vscode.commands.registerCommand('extension.showModFileContextMenuFromTreeView', () => {
        const selectedNodes = treeView.selection;
        if (!selectedNodes || selectedNodes.length === 0) {
            vscode.window.showInformationMessage('No items selected.');
            return;
        }
        (0, commands_1.showModFileContextMenu)(selectedNodes);
    }), vscode.commands.registerCommand('extension.showModFileContextMenuNONMEM', (uri) => {
        (0, commands_1.showModFileContextMenuNONMEM)([uri], context);
    }), vscode.commands.registerCommand('extension.showSumoCommand', () => {
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
                        const panel = vscode.window.createWebviewPanel('sumoOutput', outputFileName, vscode.ViewColumn.One, {});
                        panel.webview.html = getWebviewContent(data);
                    });
                });
            }
        });
    }), vscode.commands.registerCommand('extension.manageRScriptCommand', (node) => {
        const scriptsFolder = path.join(context.extensionPath, 'Rscripts');
        if (!fs.existsSync(scriptsFolder)) {
            fs.mkdirSync(scriptsFolder);
        }
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(scriptsFolder), true);
    }), vscode.commands.registerCommand('extension.showRScriptCommandFromTreeView', () => {
        const selectedNodes = treeView.selection;
        if (!selectedNodes || selectedNodes.length === 0) {
            vscode.window.showInformationMessage('No items selected.');
            return;
        }
        (0, commands_1.showRScriptCommand)(context, selectedNodes);
    }), vscode.commands.registerCommand('extension.showRScriptCommandFromEditor', (uri) => {
        (0, commands_1.showRScriptCommand)(context, [uri]);
    }), vscode.commands.registerCommand('extension.showLinkedFiles', async (node) => {
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
            const additionalFiles = [];
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
                    vscode.workspace.openTextDocument(vscode.Uri.file(selected.description)).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        });
    }), vscode.commands.registerCommand('extension.showHeatmap', function () {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const content = editor.document.getText();
            const tables = parseTables(content);
            const panel = vscode.window.createWebviewPanel('heatmapViewer', 'Heatmap Viewer', vscode.ViewColumn.One, {
                enableScripts: true
            });
            panel.webview.html = getWebviewContent_heatmap(tables);
        }
        else {
            vscode.window.showErrorMessage('No active editor found. Please open a file first.');
        }
    }));
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
    context.subscriptions.push(vscode.commands.registerCommand('extension.readNmTableAndPlot', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const fileName = document.fileName;
            if (fileName.match(/sdtab\d*|patab\d*/)) {
                const data = await readNmTable(fileName);
                const panel = vscode.window.createWebviewPanel('nmTablePlot', 'NM Table Plot', vscode.ViewColumn.One, { enableScripts: true });
                // Get the current theme
                const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
                panel.webview.html = getWebviewContent_plotly(data, theme);
                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(message => {
                    if (message.command === "updatePlot") {
                        panel.webview.postMessage({ command: "plotData", data: data, config: message.config });
                    }
                });
            }
        }
    }));
}
exports.activate = activate;
function getWebviewContent(output) {
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
function parseTables(content) {
    const tables = content.split(/TABLE\s/).filter((section) => section.trim() !== '');
    return tables.map((table) => {
        const rows = table.trim().split('\n');
        return rows.map((row) => row.trim().split(/\s+/).map(cell => parseFloat(cell) || cell));
    });
}
function getWebviewContent_heatmap(tables) {
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    tables.forEach(table => {
        table.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                if (rowIndex - 1 !== colIndex) {
                    if (!isNaN(cell)) {
                        min = Math.min(min, cell);
                        max = Math.max(max, cell);
                    }
                }
            });
        });
    });
    const tablesHTML = tables.map(table => {
        const rowsHTML = table.map((row, rowIndex) => {
            if (rowIndex === 0) {
                return '';
            }
            const cellsHTML = row.map((cell, colIndex) => {
                const isOffDiagonal = rowIndex - 1 !== colIndex;
                const cellStyle = isOffDiagonal ? `style="background-color: ${getColor(cell, min, max)}"` : '';
                return `<td ${cellStyle}>${cell}</td>`;
            }).join('');
            return `<tr>${cellsHTML}</tr>`;
        }).join('');
        return `<table>${rowsHTML}</table>`;
    }).join('<br><br>');
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
function getColor(value, min, max) {
    const range = Math.max(Math.abs(min), Math.abs(max));
    const normalizedValue = value / range;
    const hue = 120 * (1 - normalizedValue);
    if (normalizedValue === 0) {
        return `hsl(0, 0%, 60%, 30%)`;
    }
    return `hsl(${hue}, 100%, 50%, 60%)`;
}
async function readNmTable(filePath) {
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
                const row = {};
                header.forEach((col, index) => {
                    row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                });
                return row;
            });
            resolve(rows);
        });
    });
}
function getWebviewContent_plotly(data, theme) {
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
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map