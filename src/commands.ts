import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function isUriArray(nodes: any[]): nodes is vscode.Uri[] {
    return nodes.every(node => node instanceof vscode.Uri);
}

function isTreeItemArray(nodes: any[]): nodes is (vscode.TreeItem & { uri: vscode.Uri })[] {
    return nodes.every(node => node instanceof vscode.TreeItem && 'uri' in node);
}

function showCommandWithOptions(
    defaultCommand: string,
    prompt: string
): Promise<{ command: string; useTmux: boolean } | undefined> {
    return new Promise(resolve => {
        const qp = vscode.window.createQuickPick();
        qp.value = defaultCommand;
        qp.placeholder = prompt;
        qp.canSelectMany = false;

        const terminalItem: vscode.QuickPickItem = {
            label: 'Terminal',
            description: 'use default terminal',
            iconPath: new vscode.ThemeIcon('terminal'),
            alwaysShow: true
        };
        const tmuxItem: vscode.QuickPickItem = {
            label: 'Run in tmux',
            description: 'run in a persistent tmux session (requires separate installation)',
            iconPath: new vscode.ThemeIcon('terminal', new vscode.ThemeColor('charts.green')),
            alwaysShow: true
        };

        qp.items = [terminalItem, tmuxItem];
        qp.activeItems = [terminalItem];

        let settled = false;

        qp.onDidAccept(() => {
            if (settled) { return; }
            settled = true;
            const command = qp.value;
            const useTmux = qp.activeItems[0]?.label === 'Run in tmux';
            qp.dispose();
            resolve({ command, useTmux });
        });

        qp.onDidHide(() => {
            if (!settled) {
                settled = true;
                qp.dispose();
                resolve(undefined);
            }
        });

        qp.show();
    });
}

function launchCommand(input: string, terminalName: string, cwd: string, useTmux: boolean) {
    const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;
    const terminal = vscode.window.createTerminal({ name: terminalName, cwd, shellPath });
    if (useTmux) {
        const sessionName = terminalName.replace(/[^a-zA-Z0-9_-]/g, '_');
        // escape single quotes for tmux shell argument
        const escaped = input.replace(/'/g, `'\\''`);
        terminal.sendText(`tmux new-session -s '${sessionName}' '${escaped}'`);
    } else {
        terminal.sendText(input);
    }
    terminal.show();
}

// Function for PsN(Perl-speaks-NONMEM) run
export function showModFileContextMenu(nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[]) {
    let uris: vscode.Uri[];

    if (isUriArray(nodes)) {
        uris = nodes;
    } else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    } else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }

    if (uris.length === 0) {
        vscode.window.showInformationMessage('No items selected.');
        return;
    }

    vscode.window.showQuickPick([
        'execute',
        'vpc',
        'npc',
        'bootstrap',
        'cdd',
        'llp',
        'sir',
        'ebe_npde',
        'sse',
        'scm',
        'xv_scm',
        'boot_scm',
        'lasso',
        'nca',
        'nonpb',
        'mimp',
        'gls',
        'parallel_retries',
        'precond',
        'update_inits'
    ]).then(selectedCommand => {
        if (selectedCommand) {
            const fileNames = uris.map(uri => path.basename(uri.fsPath)).join(' ');

            if (selectedCommand === 'execute') {
                vscode.window.showQuickPick([
                    { label: '-rplots=1', description: 'generate basic rplots after model run' },
                    { label: '-zip', description: 'compressed results in .zip file' },
                    { label: '-display_iterations', description: 'display iterations' }
                ], {
                    canPickMany: true,
                    placeHolder: 'Select optional commands to add'
                }).then(selectedOptions => {
                    const optionsString = selectedOptions ? selectedOptions.map(opt => opt.label).join(' ') : '';
                    showCommandWithOptions(`execute ${optionsString} ${fileNames}`, `Parameters for ${selectedCommand}:`).then(result => {
                        if (result) { launchCommand(result.command, path.basename(uris[0].fsPath), path.dirname(uris[0].fsPath), result.useTmux); }
                    });
                });
            } else if (selectedCommand === 'vpc') {
                vscode.window.showQuickPick([
                    { label: '-rplots=1', description: 'generate basic rplots after model run' },
                    { label: '-predcorr', description: 'perform prediction corrected VPC' },
                    { label: '-stratify_on=', description: 'stratification' },
                    { label: '-varcorr', description: 'variability correction on DVs before computing' },
                    { label: '-dir=', description: 'name direction for output' }
                ], {
                    canPickMany: true,
                    placeHolder: 'Select optional commands to add'
                }).then(selectedOptions => {
                    const optionsString = selectedOptions ? selectedOptions.map(opt => opt.label).join(' ') : '';
                    showCommandWithOptions(`vpc -samples=200 -auto_bin=auto ${optionsString} ${fileNames}`, `Parameters for ${selectedCommand}:`).then(result => {
                        if (result) { launchCommand(result.command, path.basename(uris[0].fsPath), path.dirname(uris[0].fsPath), result.useTmux); }
                    });
                });
            } else if (selectedCommand === 'bootstrap') {
                vscode.window.showQuickPick([
                    { label: '-rplots=1', description: 'generate basic rplots after model run' },
                    { label: '-stratify_on=', description: 'stratification' },
                    { label: '-dir=', description: 'name direction for output' },
                    { label: '-keep covariance=', description: 'Keep $COV, can affect run time significantly' },
                    { label: '-allow_ignore_id', description: 'Program continues execution with IGNORE/ACCEPT statement' }
                ], {
                    canPickMany: true,
                    placeHolder: 'Select optional commands to add'
                }).then(selectedOptions => {
                    const optionsString = selectedOptions ? selectedOptions.map(opt => opt.label).join(' ') : '';
                    showCommandWithOptions(`bootstrap -samples=100 -threads=4 ${optionsString} ${fileNames}`, `Parameters for ${selectedCommand}:`).then(result => {
                        if (result) { launchCommand(result.command, path.basename(uris[0].fsPath), path.dirname(uris[0].fsPath), result.useTmux); }
                    });
                });
            } else {
                let defaultCommandSyntax = '';

                switch (selectedCommand) {
                    case 'npc':
                        defaultCommandSyntax = `npc -samples=200 ${fileNames}`;
                        break;
                    case 'cdd':
                        defaultCommandSyntax = `cdd -case_column=ID -bins=100 ${fileNames}`;
                        break;
                    case 'llp':
                        defaultCommandSyntax = `llp -omegas='' --sigmas='' --thetas='' ${fileNames}`;
                        break;
                    case 'sir':
                        defaultCommandSyntax = `sir -samples=500 -resample ${fileNames}`;
                        break;
                    case 'ebe_npde':
                        defaultCommandSyntax = `ebe_npde ${fileNames}`;
                        break;
                    case 'sse':
                        defaultCommandSyntax = `sse -samples=500 -no_estimate_simulation - alt=run1.mod ${fileNames}`;
                        break;
                    case 'scm':
                        defaultCommandSyntax = `scm -config_file ${fileNames}`;
                        break;
                    case 'xv_scm':
                        defaultCommandSyntax = `xv_scm -config_file= ${fileNames}`;
                        break;
                    case 'boot_scm':
                        defaultCommandSyntax = `boot_scm -samples=100 -threads=4 -config_file= ${fileNames}`;
                        break;
                    case 'lasso':
                        defaultCommandSyntax = `lasso ${fileNames}`;
                        break;
                    case 'nca':
                        defaultCommandSyntax = `nca -samples=500 -columns=CL,V ${fileNames}`;
                        break;
                    case 'nonpb':
                        defaultCommandSyntax = `nonpb ${fileNames}`;
                        break;
                    case 'mimp':
                        defaultCommandSyntax = `mimp ${fileNames}`;
                        break;
                    case 'gls':
                        defaultCommandSyntax = `gls ${fileNames}`;
                        break;
                    case 'parallel_retries':
                        defaultCommandSyntax = `parallel_retries -min_retries=10 -thread=5 -seed=12345 -degree=0.9 ${fileNames}`;
                        break;
                    case 'precond':
                        defaultCommandSyntax = `precond ${fileNames}`;
                        break;
                    case 'update_inits':
                        defaultCommandSyntax = `update_inits ${fileNames} -out=${fileNames}`;
                        break;
                }

                showCommandWithOptions(defaultCommandSyntax, `Parameters for ${selectedCommand}:`).then(result => {
                    if (result) { launchCommand(result.command, path.basename(uris[0].fsPath), path.dirname(uris[0].fsPath), result.useTmux); }
                });
            }
        }
    });
}

// Function For NONMEM run
export function showModFileContextMenuNONMEM(nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[]) {
    let uris: vscode.Uri[];

    if (isUriArray(nodes)) {
        uris = nodes;
    } else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    } else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }

    if (uris.length === 0) {
        vscode.window.showInformationMessage('No items selected.');
        return;
    }

    const fileNames = uris.map(uri => path.basename(uri.fsPath)).join(' ');
    const fileNamesLst = uris.map(uri => path.basename(uri.fsPath).replace(/\.(mod|ctl)$/i, '.lst')).join(' ');

    const config = vscode.workspace.getConfiguration('nmbench');
    const settingPath = config.get<string>('nonmem.executablePath', '');
    const previousInput = settingPath || '/opt/nm75/util/nmfe75';
    let defaultCommandSyntax = `${previousInput} ${fileNames} ${fileNamesLst}`;

    vscode.window.showInputBox({
        prompt: `Correct NONMEM path accordingly. ex) /opt/nm75/util/nmfe75 for v7.5.x:`,
        value: defaultCommandSyntax
    }).then(input => {
        if (input) {
            const [nonmemPath] = input.split(' ', 1);
            config.update('nonmem.executablePath', nonmemPath, vscode.ConfigurationTarget.Global);
            const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
            const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

            const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
            terminal.sendText(input);
            terminal.show();
        }
    });
}

// Running Rscript
export async function deleteModelFiles(nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[]) {
    let uris: vscode.Uri[];
    if (isUriArray(nodes)) {
        uris = nodes;
    } else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    } else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }
    if (uris.length === 0) { return; }

    const RELATED_EXTS = ['.lst', '.ext', '.cov', '.cor', '.coi', '.phi', '.shk', '.grd', '.xml'];

    // Collect all files/dirs to delete
    const toDelete: string[] = [];
    for (const uri of uris) {
        const base = uri.fsPath.replace(/\.[^.]+$/, '');
        const dir = path.dirname(uri.fsPath);

        toDelete.push(uri.fsPath);

        for (const ext of RELATED_EXTS) {
            const candidate = base + ext;
            if (fs.existsSync(candidate)) { toDelete.push(candidate); }
        }

        // PsN run directories: check command.txt inside each subdirectory
        const modelFileName = path.basename(uri.fsPath);
        try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const fullPath = path.join(dir, entry);
                if (!fs.statSync(fullPath).isDirectory()) { continue; }
                const commandTxt = path.join(fullPath, 'command.txt');
                if (!fs.existsSync(commandTxt)) { continue; }
                const cmdContent = fs.readFileSync(commandTxt, 'utf-8').trim();
                // extract last .mod/.ctl filename from command
                const match = cmdContent.match(/(\S+\.(?:mod|ctl))\s*$/i);
                if (match && path.basename(match[1]) === modelFileName) {
                    toDelete.push(fullPath);
                }
            }
        } catch { /* skip */ }
    }

    const uniqueItems = [...new Set(toDelete)];
    const displayList = uniqueItems.map(p => `  • ${path.basename(p)}`).join('\n');
    const answer = await vscode.window.showWarningMessage(
        `Delete the following ${uniqueItems.length} item(s)?\n\n${displayList}`,
        { modal: true },
        'Delete'
    );
    if (answer !== 'Delete') { return; }

    for (const item of uniqueItems) {
        try {
            const stat = fs.statSync(item);
            if (stat.isDirectory()) {
                fs.rmSync(item, { recursive: true, force: true });
            } else {
                fs.unlinkSync(item);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to delete ${path.basename(item)}: ${err}`);
        }
    }
}

export function runUpdateInits(nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[]) {
    let uris: vscode.Uri[];
    if (isUriArray(nodes)) {
        uris = nodes;
    } else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    } else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }
    if (uris.length === 0) { return; }

    const fileNames = uris.map(uri => path.basename(uri.fsPath)).join(' ');
    const outName = uris.length === 1 ? path.basename(uris[0].fsPath) : fileNames;
    const defaultCmd = `update_inits ${fileNames} -out=${outName}`;

    showCommandWithOptions(defaultCmd, 'Parameters for update_inits:').then(result => {
        if (result) { launchCommand(result.command, path.basename(uris[0].fsPath), path.dirname(uris[0].fsPath), result.useTmux); }
    });
}

export function showRScriptCommand(context: vscode.ExtensionContext, nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[]) {
    let uris: vscode.Uri[];

    if (isUriArray(nodes)) {
        uris = nodes;
    } else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    } else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }

    if (uris.length === 0) {
        vscode.window.showInformationMessage('No items selected.');
        return;
    }

    const scriptsFolder = path.join(context.extensionPath, 'Rscripts');
    if (!fs.existsSync(scriptsFolder)) {
        fs.mkdirSync(scriptsFolder);
    }

    fs.readdir(scriptsFolder, (err, files) => {
        if (err) {
            vscode.window.showErrorMessage(`Error reading scripts folder: ${err.message}`);
            return;
        }

        const scriptFiles = files.map(file => ({
            label: path.basename(file),
            description: path.join(scriptsFolder, file)
        }));

        const toForwardSlashPath = (inputPath: string): string => {
            return inputPath.replace(/\\/g, '/');
        };
        

        vscode.window.showQuickPick(scriptFiles, { placeHolder: 'Select an R script to execute' }).then(selected => {
            if (selected) {
                const firstUri = uris[0];
                let workingDir = path.dirname(firstUri.fsPath);
                workingDir = toForwardSlashPath(workingDir); // forward slash to the path

                const baseFileName = path.basename(firstUri.fsPath);

                const scriptPath = selected.description!;
                let scriptContent = fs.readFileSync(scriptPath, 'utf-8');

                scriptContent = scriptContent.replace(/nmbench_selec <- # MODEL_FILE_IN/g, `nmbench_selec <- "${baseFileName}"`);
                scriptContent = scriptContent.replace(/nmbench_wkdir <- # MODEL_FOLDER_IN/g, `nmbench_wkdir <- "${workingDir}"`);

                const tempScriptPath = path.join(workingDir, `temp_${path.basename(scriptPath)}`);
                fs.writeFileSync(tempScriptPath, scriptContent);

                const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
                const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

                const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
                terminal.sendText(`Rscript "${tempScriptPath}"`);
                terminal.show();

                const disposable = vscode.window.onDidCloseTerminal(closedTerminal => {
                    if (closedTerminal === terminal) {
                        disposable.dispose();
                        try { fs.unlinkSync(tempScriptPath); } catch { /* already removed */ }
                    }
                });
            }
        });
    });
}