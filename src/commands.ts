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
                    const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

                    let defaultCommandSyntax = `execute ${optionsString} ${fileNames}`;

                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
                            const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
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
                    const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

                    let defaultCommandSyntax = `vpc -samples=200 -auto_bin=auto ${optionsString} ${fileNames}`;

                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
                            const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
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
                    const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

                    let defaultCommandSyntax = `bootstrap -samples=100 -threads=4 ${optionsString} ${fileNames}`;

                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
                            const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
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

                vscode.window.showInputBox({
                    prompt: `Enter parameters for ${selectedCommand}:`,
                    value: defaultCommandSyntax
                }).then(input => {
                    if (input) {
                        const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
                        const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

                        const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
                        terminal.sendText(`${input}`);
                        terminal.show();
                    }
                });
            }
        }
    });
}

// Function For NONMEM run
export function showModFileContextMenuNONMEM(nodes: (vscode.Uri | (vscode.TreeItem & { uri: vscode.Uri }))[], context: vscode.ExtensionContext) {
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
    const previousInput = context.globalState.get<string>('nonmemPath', '/opt/nm75/util/nmfe75');
    let defaultCommandSyntax = `${previousInput} ${fileNames} ${fileNamesLst}`;

    vscode.window.showInputBox({
        prompt: `Correct NONMEM path accordingly. ex) /opt/nm75/util/nmfe75 for v7.5.x:`,
        value: defaultCommandSyntax
    }).then(input => {
        if (input) {
            const [nonmemPath] = input.split(' ', 1);
            context.globalState.update('nonmemPath', nonmemPath);
            const terminalName = path.basename(uris[0].fsPath); // 터미널 이름을 파일 이름으로 설정
            const shellPath = os.platform() === 'win32' ? 'cmd.exe' : undefined;

            const terminal = vscode.window.createTerminal({ name: terminalName, cwd: path.dirname(uris[0].fsPath), shellPath: shellPath });
            terminal.sendText(input);
            terminal.show();
        }
    });
}

// Running Rscript
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

                setTimeout(() => {
                    if (fs.existsSync(tempScriptPath)) {
                        fs.unlinkSync(tempScriptPath);
                    }
                }, 20000); // 20 seconds delay before deleting the temporary script
            }
        });
    });
}