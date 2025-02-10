import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as childProcess from 'child_process';
import { EstimatesViewerProvider } from './estview';
import { ModFile, ModFolder, ModFileViewerProvider } from './modview';
import { showModFileContextMenu, showModFileContextMenuNONMEM, showRScriptCommand } from './commands';
import { readNmTable, readNmTable_heatmap, readNmTable_ext } from './tblread';
import { getWebviewContent, getWebviewContent_plotly, getWebviewContent_heatmap_plotly, getWebviewContent_table, getWebviewContent_hist } from './webview';

const readFile = util.promisify(fs.readFile);

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


    const estimatesViewerProvider = new EstimatesViewerProvider();
    vscode.window.createTreeView('estimatesViewer', { treeDataProvider: estimatesViewerProvider });

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.refreshEstimatesViewer', () => estimatesViewerProvider.refresh()),

        vscode.commands.registerCommand('extension.revealEstimateInLst', async (paramLabel: string) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const modFilePath = editor.document.uri.fsPath;
            const lstFilePath = modFilePath.replace(/\.[^.]+$/, '.lst');
            if (!fs.existsSync(lstFilePath)) { return; }

            const doc = await vscode.workspace.openTextDocument(lstFilePath);
            const lstEditor = await vscode.window.showTextDocument(doc);
            const text = doc.getText();
            const position = text.indexOf(paramLabel);

            if (position !== -1) {
                const pos = doc.positionAt(position);
                lstEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
            }
        })
    );

    vscode.window.onDidChangeActiveTextEditor(() => estimatesViewerProvider.refresh());
}



export function deactivate() { }