import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import * as childProcess from 'child_process';
import { EstimatesWebViewProvider } from './estview';
import { ModelDevViewProvider } from './modelDevView';
import { openAmdReport } from './amdReport';
import { findRscript, formatRscriptCommand } from './rscriptRunner';
import { ModFile, ModFolder, ModFileViewerProvider, nmbenchDecorationProvider, getModelFileRegex } from './modview';
import { showModFileContextMenu, showModFileContextMenuNONMEM, showRScriptCommand, runUpdateInits, deleteModelFiles } from './commands';
import { readNmTable, readNmTable_heatmap, readNmTable_ext } from './tblread';
import { getWebviewContent, getWebviewContent_plotly, getWebviewContent_heatmap_plotly, getWebviewContent_table, getWebviewContent_hist, getWebviewContent_liveExt } from './webview';

const readFile = util.promisify(fs.readFile);


// findRscript / formatRscriptCommand / runRscriptFileInTerminal live in
// src/rscriptRunner.ts so the sub-panels can reuse them.

async function seedDecorations(dirPath: string): Promise<void> {
    let entries: string[];
    try { entries = await fs.promises.readdir(dirPath); } catch { return; }
    const modRegex = getModelFileRegex();
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
                await seedDecorations(fullPath);
            } else if (modRegex.test(entry)) {
                const modFile = new ModFile(vscode.Uri.file(fullPath));
                await modFile.initialize();
            }
        } catch { continue; }
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Plotly is bundled locally (resources/lib/plotly-*.min.js) so web-based VS Code forks
    // (code-server, Gitpod, github.dev) can render charts under their stricter webview CSP,
    // which blocks external CDN scripts. Each webview panel resolves the bundled asset via
    // asWebviewUri() to get a vscode-webview:// URL that's automatically allowlisted.
    const plotlyResourceUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'lib', 'plotly-2.32.0.min.js');
    const getPlotlyUri = (webview: vscode.Webview) => webview.asWebviewUri(plotlyResourceUri).toString();

    const activeRunningTerminals = new Set<vscode.Terminal>();
    const shellIntegrationSeenTerminals = new Set<vscode.Terminal>();
    const modFileViewerProvider = new ModFileViewerProvider(activeRunningTerminals, shellIntegrationSeenTerminals);
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(nmbenchDecorationProvider));
    vscode.workspace.workspaceFolders?.forEach(folder => seedDecorations(folder.uri.fsPath));
    const treeView = vscode.window.createTreeView('modFileViewer', {
        treeDataProvider: modFileViewerProvider,
        canSelectMany: true // 전체 트리에 다중 선택 허용
    });
    let estimatesProvider: EstimatesWebViewProvider | undefined;

    // 상태 메시지 갱신 함수: 토글 상태에 따라 뷰 상단에 안내 문구 표시
    const updateViewMessage = () => {
      const hide = vscode.workspace
        .getConfiguration('nmbench')
        .get<boolean>('modFileViewer.hideModelFitDirs', false);
      treeView.message = hide
        ? "Hiding: folders with 'modelfit_dir'"
        : "Showing: all folders";
    };

      // 토글 커맨드: 설정값 토글 후 새로고침
  const toggleHide = vscode.commands.registerCommand('extension.toggleHideModelFitDirs', async () => {
    const config = vscode.workspace.getConfiguration('nmbench');
    const key = 'modFileViewer.hideModelFitDirs';
    const current = config.get<boolean>(key, false);
    await config.update(key, !current, vscode.ConfigurationTarget.Global);
    vscode.commands.executeCommand('extension.refreshModFileViewer');
  });
  context.subscriptions.push(toggleHide);

  // Opens the Settings UI filtered to the nmbench section so users can edit configuration
  // (file extensions, NONMEM path, hide toggle) without hunting through settings.json.
  const openSettings = vscode.commands.registerCommand('extension.openNmbenchSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tnzo12.nmbench');
  });
  context.subscriptions.push(openSettings);

  // Runs the bundled pharmpy_install.R script directly in a terminal via
  // `Rscript`. Cross-platform: works on macOS, Windows, and Linux. The script
  // itself is idempotent — every step (miniconda install, conda env create,
  // pharmr/pharmpy install) is skipped when already satisfied, and it prints
  // system diagnostics up-front so users can see which Python / conda / R the
  // run is bound to.
  //
  // Rscript resolution: first tries PATH, then on Windows falls back to the
  // standard R install locations (`C:\Program Files\R\R-*\bin\[x64\]Rscript.exe`).
  // This catches the common case where a user installed R but forgot to tick
  // "Add R to PATH" during setup. If no Rscript can be found we prompt the
  // user to install R from CRAN.
  // AMD Report — reads on-disk artifacts (metadata.json / results.json /
  // subtool subdirs) from an AMD output folder and renders them in a webview.
  // Workaround for pharmpy's built-in report failing on Windows via reticulate
  // (pharmpy/pharmpy#3399). Invoked from the BROWSER tree by right-clicking
  // a folder; also usable from the command palette on the active file's dir.
  const generateAmdReport = vscode.commands.registerCommand('extension.generateAmdReport', async (node?: { resourceUri?: vscode.Uri }) => {
    let uri: vscode.Uri | undefined = node?.resourceUri;
    if (!uri) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select AMD output folder'
      });
      if (!picked || picked.length === 0) { return; }
      uri = picked[0];
    }
    await openAmdReport(uri, context.extensionUri);
  });
  context.subscriptions.push(generateAmdReport);

  const openPharmrSetup = vscode.commands.registerCommand('extension.openPharmrSetup', async () => {
    const scriptUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'pharmpy_install.R');
    try {
      await vscode.workspace.fs.stat(scriptUri);
    } catch {
      vscode.window.showErrorMessage(`pharmpy_install.R not found at ${scriptUri.fsPath}`);
      return;
    }
    const loc = findRscript();
    if (!loc) {
      const install = 'Open CRAN download page';
      const choice = await vscode.window.showErrorMessage(
        'Rscript could not be found. Install R first — on Windows, be sure to tick "Add R to PATH" during the installer.',
        install
      );
      if (choice === install) {
        vscode.env.openExternal(vscode.Uri.parse('https://cran.r-project.org/'));
      }
      return;
    }
    const scriptPath = scriptUri.fsPath;
    const term = vscode.window.createTerminal({ name: 'nmbench: pharmpy install' });
    term.show(true);
    term.sendText(formatRscriptCommand(loc, scriptPath));
  });
  context.subscriptions.push(openPharmrSetup);

  // 설정 변경 감지 → 자동 새로고침
  const disp = vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('nmbench.modFileViewer.hideModelFitDirs') ||
      e.affectsConfiguration('nmbench.browser.fileExtensions')
    ) {
      vscode.commands.executeCommand('extension.refreshModFileViewer');
    }
  });
  context.subscriptions.push(disp);

    const getEstimatesContextUri = (): vscode.Uri | undefined => {
        const estimatesPath = estimatesProvider?.getCurrentFilePath();
        if (estimatesPath && fs.existsSync(estimatesPath)) {
            return vscode.Uri.file(estimatesPath);
        }
        return vscode.window.activeTextEditor?.document?.uri;
    };

    const extractTableFileNames = (content: string): string[] => {
        const fileNames: string[] = [];
        const tableRegex = /\$TABLE\b[\s\S]*?\bFILE\s*=\s*([^\s,]+)/gi;
        let match: RegExpExecArray | null;
        while ((match = tableRegex.exec(content)) !== null) {
            let fileName = match[1].trim();
            fileName = fileName.replace(/^['"]|['"]$/g, '');
            fileName = fileName.replace(/[;,)\]]$/, '');
            fileName = fileName.replace(/^[^\w.\-\/]+|[^\w.\-\/]+$/g, '');
            if (fileName) {
                fileNames.push(fileName);
            }
        }
        return fileNames;
    };

    const buildLinkedFileItems = async (nodeUri: vscode.Uri): Promise<{ label: string; description: string }[]> => {
        const dir = path.dirname(nodeUri.fsPath);
        const baseName = path.basename(nodeUri.fsPath, path.extname(nodeUri.fsPath));
        const files = await fs.promises.readdir(dir);
        const linkedFiles = files
            .filter(file => path.basename(file, path.extname(file)) === baseName && file !== path.basename(nodeUri.fsPath))
            .map(file => ({
                label: path.basename(file),
                description: path.join(dir, file)
            }));

        const candidateFiles: string[] = [nodeUri.fsPath];
        const ext = path.extname(nodeUri.fsPath).toLowerCase();
        if (ext === '.lst') {
            const modPath = path.join(dir, `${baseName}.mod`);
            const ctlPath = path.join(dir, `${baseName}.ctl`);
            if (fs.existsSync(modPath)) {
                candidateFiles.push(modPath);
            } else if (fs.existsSync(ctlPath)) {
                candidateFiles.push(ctlPath);
            }
        }

        const additionalFiles: { label: string; description: string; }[] = [];
        for (const candidatePath of candidateFiles) {
            let fileContent = '';
            try {
                fileContent = await readFile(candidatePath, 'utf-8');
            } catch {
                continue;
            }
            const tableFileNames = extractTableFileNames(fileContent);
            for (const tableFileName of tableFileNames) {
                const filePath = path.isAbsolute(tableFileName)
                    ? tableFileName
                    : path.join(dir, tableFileName);
                if (fs.existsSync(filePath)) {
                    additionalFiles.push({
                        label: path.basename(filePath),
                        description: filePath
                    });
                } else if (!path.extname(tableFileName)) {
                    const tableBaseName = path.basename(tableFileName);
                    const targetDir = path.isAbsolute(tableFileName)
                        ? path.dirname(tableFileName)
                        : path.join(dir, path.dirname(tableFileName));
                    const dirFiles = targetDir === dir
                        ? files
                        : await fs.promises.readdir(targetDir).catch(() => []);
                    const matches = dirFiles
                        .filter(file => path.basename(file, path.extname(file)).toLowerCase() === tableBaseName.toLowerCase())
                        .map(file => ({
                            label: path.basename(file),
                            description: path.join(targetDir, file)
                        }));
                    additionalFiles.push(...matches);
                }
            }
        }

        const dedupedFiles = new Map<string, { label: string; description: string }>();
        [...linkedFiles, ...additionalFiles].forEach(item => {
            dedupedFiles.set(item.description, item);
        });
        return Array.from(dedupedFiles.values());
    };

    const isPlotCandidate = (filePath: string): boolean => {
        const ext = path.extname(filePath).toLowerCase();
        if (['.tab', '.table', '.csv', '.tsv', '.txt', '.phi'].includes(ext)) {
            return true;
        }
        const base = path.basename(filePath, ext);
        return /tab|table/i.test(base);
    };

    const openTablePlotPanel = async (filePath: string) => {
        const data = await readNmTable(filePath);
        const panel = vscode.window.createWebviewPanel(
            'nmTablePlot',
            `NM Table Plot: ${path.basename(filePath)}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
        panel.webview.html = getWebviewContent_plotly(data, theme, getPlotlyUri(panel.webview));
        panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'requestData') {
                panel.webview.postMessage({ command: 'plotData', data: data });
            }
            if (message.command === 'updatePlot') {
                panel.webview.postMessage({ command: 'plotData', data: data, config: message.config });
            }
        });
    };

    const openHistogramPanel = async (filePath: string) => {
        const data = await readNmTable(filePath);
        const panel = vscode.window.createWebviewPanel(
            'histogramPlot',
            `Histogram Plot: ${path.basename(filePath)}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
        panel.webview.html = getWebviewContent_hist(data, theme, getPlotlyUri(panel.webview));
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.openModFile', (uri: vscode.Uri) => {
            vscode.workspace.openTextDocument(uri).then(doc => {
                vscode.window.showTextDocument(doc, vscode.ViewColumn.One, true);
            });
        }),

        vscode.commands.registerCommand('extension.refreshModFileViewer', () => {
            modFileViewerProvider.refresh();
            updateViewMessage();
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
                        const modRegex = getModelFileRegex();
                        const modFiles = files
                            .filter(([name, fileType]) => fileType === vscode.FileType.File && modRegex.test(name))
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
            showModFileContextMenuNONMEM([uri]);
        }),
        vscode.commands.registerCommand('extension.runUpdateInits', (node?: ModFile) => {
            const selectedNodes = node ? [node] : treeView.selection.filter(n => n instanceof ModFile);
            if (selectedNodes.length === 0) { return; }
            runUpdateInits(selectedNodes as ModFile[]);
        }),
        vscode.commands.registerCommand('extension.deleteModelFiles', (node?: ModFile) => {
            const selectedNodes = node ? [node] : treeView.selection.filter(n => n instanceof ModFile);
            if (selectedNodes.length === 0) { return; }
            deleteModelFiles(selectedNodes as ModFile[]).then(() => modFileViewerProvider.refresh());
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
                const contextUri = getEstimatesContextUri();
                if (!contextUri) {
                    vscode.window.showErrorMessage('No file selected.');
                    return;
                }
                if (!contextUri.fsPath.match(/\.(mod|ctl|lst)$/)) {
                    vscode.window.showErrorMessage('The active file is not a MOD, CTL, or LST file.');
                    return;
                }
                node = new ModFile(contextUri);
            }
            let allFiles: { label: string; description: string }[] = [];
            try {
                allFiles = await buildLinkedFileItems(node.uri);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Error reading directory: ${message}`);
                return;
            }
            if (allFiles.length === 0) {
                vscode.window.showInformationMessage('No linked files found.');
                return;
            }

            const selected = await vscode.window.showQuickPick(allFiles);
            if (selected) {
                const selectedUri = vscode.Uri.file(selected.description!);
                const selectedExt = path.extname(selectedUri.fsPath).toLowerCase();
                if (selectedExt === '.ext') {
                    vscode.commands.executeCommand('extension.readExtFile', selectedUri);
                    return;
                }
                if (['.cov', '.cor', '.coi'].includes(selectedExt)) {
                    vscode.commands.executeCommand('extension.showHeatmap', selectedUri);
                    return;
                }
                vscode.workspace.openTextDocument(selectedUri).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        }),

        vscode.commands.registerCommand('extension.showHeatmap', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }

            const fileName = targetUri.fsPath;
            const baseFileName = path.basename(fileName);

            const data = await readNmTable_heatmap(fileName);
            const panel = vscode.window.createWebviewPanel(
                'nmTablePlot',
                `Heatmap Plot: ${baseFileName}`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            // Get the current theme
            const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
            panel.webview.html = getWebviewContent_heatmap_plotly(data, theme, baseFileName, getPlotlyUri(panel.webview));

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'updatePlot') {
                    panel.webview.postMessage({ command: 'plotData', data: data, config: message.config });
                }
            });
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
        }),
        vscode.commands.registerCommand('extension.readExtFileFromActive', async () => {
            const contextUri = getEstimatesContextUri();
            if (!contextUri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }
            vscode.commands.executeCommand('extension.readExtFile', contextUri);
        }),
        vscode.commands.registerCommand('extension.showLinkedPlotFromActive', async () => {
            const contextUri = getEstimatesContextUri();
            if (!contextUri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }
            const allFiles = await buildLinkedFileItems(contextUri);
            const plotFiles = allFiles.filter(item => isPlotCandidate(item.description));
            if (plotFiles.length === 0) {
                vscode.window.showInformationMessage('No table files found for plotting.');
                return;
            }
            const selected = await vscode.window.showQuickPick(plotFiles, { placeHolder: 'Select a table file to plot' });
            if (selected) {
                await openTablePlotPanel(selected.description);
            }
        }),
        vscode.commands.registerCommand('extension.showLinkedHistogramFromActive', async () => {
            const contextUri = getEstimatesContextUri();
            if (!contextUri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }
            const allFiles = await buildLinkedFileItems(contextUri);
            const plotFiles = allFiles.filter(item => isPlotCandidate(item.description));
            if (plotFiles.length === 0) {
                vscode.window.showInformationMessage('No table files found for histogram.');
                return;
            }
            const selected = await vscode.window.showQuickPick(plotFiles, { placeHolder: 'Select a table file for histogram' });
            if (selected) {
                await openHistogramPanel(selected.description);
            }
        }),
        vscode.commands.registerCommand('extension.showHeatmapFromActive', async () => {
            const contextUri = getEstimatesContextUri();
            if (!contextUri) {
                vscode.window.showErrorMessage('No file selected.');
                return;
            }
            const dir = path.dirname(contextUri.fsPath);
            const baseName = path.basename(contextUri.fsPath, path.extname(contextUri.fsPath));
            const candidates = ['.cov', '.cor', '.coi']
                .map(ext => path.join(dir, `${baseName}${ext}`))
                .filter(filePath => fs.existsSync(filePath));

            if (candidates.length === 0) {
                vscode.window.showErrorMessage('No .cov/.cor/.coi files found for the active file.');
                return;
            }

            const pickItems = candidates.map(filePath => ({
                label: path.basename(filePath),
                description: filePath
            }));

            const selected = await vscode.window.showQuickPick(pickItems);
            if (!selected) {
                return;
            }

            vscode.commands.executeCommand('extension.showHeatmap', vscode.Uri.file(selected.description!));
        }),
        vscode.commands.registerCommand('extension.watchLiveExt', async (node?: ModFolder | vscode.Uri) => {
            const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';

            // If invoked from a right-click on a `modelfit_dir*` folder, scope
            // the scan to that one folder (a single readdir of its NM_run*
            // subdirs — near-zero cost). Otherwise fall back to the whole
            // workspace with the recursive-with-prune walker below.
            const explicitFolder: string | undefined =
                node instanceof ModFolder ? node.uri.fsPath :
                node instanceof vscode.Uri ? node.fsPath :
                undefined;
            const panelTitle = explicitFolder
                ? `Estimation Monitor: ${path.basename(explicitFolder)}`
                : 'Estimation Monitor';

            const panel = vscode.window.createWebviewPanel(
                'liveExt', panelTitle,
                vscode.ViewColumn.Two,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            panel.webview.html = getWebviewContent_liveExt([], theme, getPlotlyUri(panel.webview));

            // runName → absolute filePath
            const runMap = new Map<string, string>();
            let activeInterval: ReturnType<typeof setInterval> | undefined;

            // Skip / depth policy for the workspace-wide fallback walk. Pruned
            // so this stays snappy on OneDrive / node_modules / pharmpy caches.
            const SKIP_DIRS = new Set([
                'node_modules', '.git', '.svn', '.hg',
                '.venv', 'venv', '__pycache__',
                '.modeldb', 'subcontexts', 'annotations',
                'dist', 'out', '.next', '.turbo', '.cache'
            ]);
            const MAX_DEPTH = 6;

            const collectFromModelfitDir = async (mfPath: string, wsRoot: string): Promise<void> => {
                let nmDirs: string[];
                try { nmDirs = await fs.promises.readdir(mfPath); } catch { return; }
                for (const sub of nmDirs) {
                    if (!/^NM_run/i.test(sub)) { continue; }
                    const psnExt = path.join(mfPath, sub, 'psn.ext');
                    try {
                        await fs.promises.access(psnExt);
                        const runName = path.relative(wsRoot, path.dirname(psnExt));
                        runMap.set(runName, psnExt);
                    } catch { /* no psn.ext yet */ }
                }
            };

            const walk = async (dir: string, wsRoot: string, depth: number): Promise<void> => {
                let entries: fs.Dirent[];
                try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
                for (const ent of entries) {
                    if (!ent.isDirectory()) { continue; }
                    const name = ent.name;
                    if (name.toLowerCase().startsWith('modelfit_dir')) {
                        await collectFromModelfitDir(path.join(dir, name), wsRoot);
                        continue; // don't recurse into a modelfit_dir itself
                    }
                    if (name.startsWith('.')) { continue; }        // hidden dirs
                    if (SKIP_DIRS.has(name.toLowerCase())) { continue; }
                    if (depth >= MAX_DEPTH) { continue; }
                    await walk(path.join(dir, name), wsRoot, depth + 1);
                }
            };

            let initialPopulated = false;

            const scanWorkspace = async (preselect: boolean = false) => {
                // Snapshot the known runs so we can tell what's new after the scan.
                const knownBefore = new Set(runMap.keys());

                if (explicitFolder) {
                    // Folder-scoped: the right-clicked folder IS the modelfit_dir.
                    // Use the folder itself as the "workspace root" for relative
                    // run names so labels stay short.
                    await collectFromModelfitDir(explicitFolder, path.dirname(explicitFolder));
                } else {
                    const wsFolders = vscode.workspace.workspaceFolders ?? [];
                    for (const wf of wsFolders) {
                        await walk(wf.uri.fsPath, wf.uri.fsPath, 0);
                    }
                }

                if (!initialPopulated) {
                    // First scan → send the full run list. Optionally pre-select
                    // the most-recently-touched run when we were launched from a
                    // right-click on a specific modelfit_dir folder.
                    let selected: string | undefined;
                    if (preselect && explicitFolder && runMap.size > 0) {
                        const withMtime = await Promise.all(
                            [...runMap.entries()].map(async ([name, p]) => {
                                const m = (await fs.promises.stat(p).catch(() => null))?.mtimeMs ?? 0;
                                return { name, mtime: m };
                            })
                        );
                        withMtime.sort((a, b) => b.mtime - a.mtime);
                        selected = withMtime[0].name;
                    }
                    panel.webview.postMessage({ command: 'populate', runs: [...runMap.keys()], selected });
                    initialPopulated = true;
                } else {
                    // Subsequent polls → only announce newly-discovered runs.
                    // Re-sending 'populate' would rebuild the <select>, wiping
                    // the user's current selection every 10 s (that was the bug).
                    for (const runName of runMap.keys()) {
                        if (!knownBefore.has(runName)) {
                            panel.webview.postMessage({ command: 'addRun', runName });
                        }
                    }
                }
            };
            scanWorkspace(/* preselect */ !!explicitFolder);

            // Poll for newly created psn.ext every 10s (bypasses watcherExclude)
            const newFileInterval = setInterval(() => { scanWorkspace(); }, 10000);

            // Handle webview messages
            panel.webview.onDidReceiveMessage(async msg => {
                if (msg.command === 'select') {
                    const filePath = runMap.get(msg.runName);
                    if (!filePath) { return; }

                    // Initial read
                    const data = await readNmTable_ext(filePath).catch(() => []);
                    panel.webview.postMessage({ command: 'data', runName: msg.runName, data });

                    // Poll for changes every 3s using fs.promises.stat + mtime
                    // (bypasses VS Code's files.watcherExclude)
                    clearInterval(activeInterval);
                    let lastMtime = (await fs.promises.stat(filePath).catch(() => null))?.mtimeMs ?? 0;
                    activeInterval = setInterval(async () => {
                        const stat = await fs.promises.stat(filePath).catch(() => null);
                        if (!stat || stat.mtimeMs <= lastMtime) { return; }
                        lastMtime = stat.mtimeMs;
                        const updated = await readNmTable_ext(filePath).catch(() => []);
                        panel.webview.postMessage({ command: 'data', runName: msg.runName, data: updated });
                    }, 3000);
                } else if (msg.command === 'refresh') {
                    scanWorkspace();
                }
            });

            panel.onDidDispose(() => { clearInterval(activeInterval); clearInterval(newFileInterval); });
        }),

        vscode.commands.registerCommand('extension.snapshotEstimatesView', () => {
            if (!estimatesProvider) {
                vscode.window.showErrorMessage('Estimates view is not ready.');
                return;
            }
            const html = estimatesProvider.getCurrentHtml();
            if (!html) {
                vscode.window.showErrorMessage('No Estimates view content to snapshot.');
                return;
            }
            const filePath = estimatesProvider.getCurrentFilePath();
            const titleSuffix = filePath ? `: ${path.basename(filePath)}` : '';
            const maxColumn = Math.max(
                ...vscode.window.tabGroups.all.map(group => group.viewColumn || 1),
                1
            );
            const targetColumn = maxColumn + 1;
            const panel = vscode.window.createWebviewPanel(
                'estimatesSnapshot',
                `Estimates Snapshot${titleSuffix}`,
                { viewColumn: targetColumn, preserveFocus: true },
                { enableScripts: true }
            );
            panel.webview.html = html;
        })
    );


    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor || editor.document.uri.scheme !== 'file') { return; }
        const fsPath = editor.document.uri.fsPath;
        let modUri: vscode.Uri | undefined;
        if (getModelFileRegex().test(fsPath)) {
            modUri = editor.document.uri;
        } else if (fsPath.match(/\.lst$/)) {
            const base = fsPath.replace(/\.[^.]+$/, '');
            if (fs.existsSync(base + '.mod')) {
                modUri = vscode.Uri.file(base + '.mod');
            } else if (fs.existsSync(base + '.ctl')) {
                modUri = vscode.Uri.file(base + '.ctl');
            }
        }
        if (modUri) {
            treeView.reveal(new ModFile(modUri), { select: true, focus: true }).then(
                undefined, () => { /* 워크스페이스 밖이거나 트리에 없는 경우 무시 */ }
            );
        }
    });

    let terminalRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedTerminalRefresh = () => {
        if (terminalRefreshTimer) { clearTimeout(terminalRefreshTimer); }
        terminalRefreshTimer = setTimeout(() => modFileViewerProvider.refresh(), 200);
    };

    vscode.window.onDidOpenTerminal(debouncedTerminalRefresh);
    vscode.window.onDidCloseTerminal(terminal => {
        activeRunningTerminals.delete(terminal);
        shellIntegrationSeenTerminals.delete(terminal);
        debouncedTerminalRefresh();
    });
    vscode.window.onDidChangeActiveTerminal(debouncedTerminalRefresh);
    const isModelTerminal = (terminal: vscode.Terminal) =>
        getModelFileRegex().test(terminal.name);

    vscode.window.onDidStartTerminalShellExecution(event => {
        shellIntegrationSeenTerminals.add(event.terminal);
        if (isModelTerminal(event.terminal)) {
            activeRunningTerminals.add(event.terminal);
            debouncedTerminalRefresh();
        }
    });
    vscode.window.onDidEndTerminalShellExecution(event => {
        if (activeRunningTerminals.delete(event.terminal)) {
            debouncedTerminalRefresh();
        }
    });
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.readNmTableAndPlot', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileName = document.fileName;

                const data = await readNmTable(fileName);
                const panel = vscode.window.createWebviewPanel(
                    'nmTablePlot',
                    'NM Table Plot',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
                panel.webview.html = getWebviewContent_plotly(data, theme, getPlotlyUri(panel.webview));

                panel.webview.onDidReceiveMessage(message => {
                    if (message.command === 'requestData') {
                        panel.webview.postMessage({ command: 'plotData', data: data });
                    }
                    if (message.command === 'updatePlot') {
                        panel.webview.postMessage({ command: 'plotData', data: data, config: message.config });
                    }
                });
            }
        })
    );

    vscode.commands.registerCommand('extension.showHistogram', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const fileName = document.fileName;
            const data = await readNmTable(fileName);
            const panel = vscode.window.createWebviewPanel(
                'histogramPlot',
                'Histogram Plot',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'vscode-dark' : 'vscode-light';
            panel.webview.html = getWebviewContent_hist(data, theme, getPlotlyUri(panel.webview));
        }
    });


    const provider = new EstimatesWebViewProvider(context);
    estimatesProvider = provider;
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(EstimatesWebViewProvider.viewType, provider)
    );

    // Model Builder + AMD Script Generator now share a single tabbed webview
    // (see modelDevView.ts) so they're mutually exclusive — expanding one
    // implicitly hides the other. Individual providers are constructed inside
    // the wrapper.
    const modelDevProvider = new ModelDevViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ModelDevViewProvider.viewType, modelDevProvider)
    );

    vscode.window.onDidChangeActiveTextEditor(() => provider.updateTable());
    vscode.workspace.onDidSaveTextDocument(() => provider.updateTable());

    updateViewMessage();
}



export function deactivate() { }
