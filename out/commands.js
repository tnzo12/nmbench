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
exports.showModFileContextMenuNONMEM = exports.showModFileContextMenu = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function isUriArray(nodes) {
    return nodes.every(node => node instanceof vscode.Uri);
}
function isTreeItemArray(nodes) {
    return nodes.every(node => node instanceof vscode.TreeItem && 'uri' in node);
}
// Function for PsN(Perl-speaks-NONMEM) run
function showModFileContextMenu(nodes) {
    let uris;
    if (isUriArray(nodes)) {
        uris = nodes;
    }
    else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    }
    else {
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
                    let defaultCommandSyntax = `execute ${optionsString} ${fileNames}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(uris[0].fsPath) });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
                    });
                });
            }
            else if (selectedCommand === 'vpc') {
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
                    let defaultCommandSyntax = `vpc -samples=200 -auto_bin=auto ${optionsString} ${fileNames}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(uris[0].fsPath) });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
                    });
                });
            }
            else if (selectedCommand === 'bootstrap') {
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
                    let defaultCommandSyntax = `bootstrap -samples=100 -threads=4 ${optionsString} ${fileNames}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(uris[0].fsPath) });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
                    });
                });
            }
            else {
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
                        const terminal = vscode.window.createTerminal({ cwd: path.dirname(uris[0].fsPath) });
                        terminal.sendText(`${input}`);
                        terminal.show();
                    }
                });
            }
        }
    });
}
exports.showModFileContextMenu = showModFileContextMenu;
// Function For NONMEM run
function showModFileContextMenuNONMEM(nodes, context) {
    let uris;
    if (isUriArray(nodes)) {
        uris = nodes;
    }
    else if (isTreeItemArray(nodes)) {
        uris = nodes.map(node => node.uri);
    }
    else {
        vscode.window.showErrorMessage('Invalid selection');
        return;
    }
    if (uris.length === 0) {
        vscode.window.showInformationMessage('No items selected.');
        return;
    }
    const fileNames = uris.map(uri => path.basename(uri.fsPath)).join(' ');
    const fileNamesLst = uris.map(uri => path.basename(uri.fsPath).replace(/\.(mod|ctl)$/i, '.lst')).join(' ');
    const previousInput = context.globalState.get('nonmemPath', '/opt/nm75/util/nmfe75');
    let defaultCommandSyntax = `${previousInput} ${fileNames} ${fileNamesLst}`;
    vscode.window.showInputBox({
        prompt: `Correct NONMEM path accordingly. ex) /opt/nm75/util/nmfe75 for v7.5.x:`,
        value: defaultCommandSyntax
    }).then(input => {
        if (input) {
            const [nonmemPath] = input.split(' ', 1);
            context.globalState.update('nonmemPath', nonmemPath);
            const terminal = vscode.window.createTerminal({ cwd: path.dirname(uris[0].fsPath) });
            terminal.sendText(input);
            terminal.show();
        }
    });
}
exports.showModFileContextMenuNONMEM = showModFileContextMenuNONMEM;
//# sourceMappingURL=commands.js.map