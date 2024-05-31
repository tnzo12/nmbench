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
exports.showModFileContextMenu = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function showModFileContextMenu(treeView) {
    const selectedNodes = treeView.selection;
    if (selectedNodes.length === 0) {
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
    ])
        .then(selectedCommand => {
        if (selectedCommand) {
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
                    let defaultCommandSyntax = `execute ${optionsString} ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(selectedNodes[0].uri.fsPath) });
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
                    let defaultCommandSyntax = `vpc -samples=200 -auto_bin=auto ${optionsString} ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(selectedNodes[0].uri.fsPath) });
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
                    let defaultCommandSyntax = `bootstrap -samples=100 -threads=4 ${optionsString} ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                    vscode.window.showInputBox({
                        prompt: `Enter parameters for ${selectedCommand}:`,
                        value: defaultCommandSyntax
                    }).then(input => {
                        if (input) {
                            const terminal = vscode.window.createTerminal({ cwd: path.dirname(selectedNodes[0].uri.fsPath) });
                            terminal.sendText(`${input}`);
                            terminal.show();
                        }
                    });
                });
            }
            else {
                let defaultCommandSyntax = '';
                switch (selectedCommand) {
                    // case 'vpc':
                    //     defaultCommandSyntax = `vpc -samples=200 -auto_bin=auto ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                    //     break;
                    case 'npc':
                        defaultCommandSyntax = `npc -samples=200 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    // case 'bootstrap':
                    //     defaultCommandSyntax = `bootstrap -samples=50 -threads=4 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                    //     break;
                    case 'cdd':
                        defaultCommandSyntax = `cdd -case_column=ID -bins=100 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'llp':
                        defaultCommandSyntax = `llp -omegas='' --sigmas='' --thetas='' ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'sir':
                        defaultCommandSyntax = `sir -samples=500 -resample ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'ebe_npde':
                        defaultCommandSyntax = `ebe_npde ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'sse':
                        defaultCommandSyntax = `sse -samples=500 -no_estimate_simulation - alt=run1.mod ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'scm':
                        defaultCommandSyntax = `scm -config_file ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'xv_scm':
                        defaultCommandSyntax = `xv_scm -config_file= ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'boot_scm':
                        defaultCommandSyntax = `boot_scm -samples=100 -threads=4 -config_file= ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'lasso':
                        defaultCommandSyntax = `lasso ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'nca':
                        defaultCommandSyntax = `nca -samples=500 -columns=CL,V ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'nonpb':
                        defaultCommandSyntax = `nonpb ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'mimp':
                        defaultCommandSyntax = `mimp ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'gls':
                        defaultCommandSyntax = `gls ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'parallel_retries':
                        defaultCommandSyntax = `parallel_retries -min_retries=10 -thread=5 -seed=12345 -degree=0.9 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'precond':
                        defaultCommandSyntax = `precond ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'update_inits':
                        defaultCommandSyntax = `update_inits ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')} -out=${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                }
                vscode.window.showInputBox({
                    prompt: `Enter parameters for ${selectedCommand}:`,
                    value: defaultCommandSyntax
                }).then(input => {
                    if (input) {
                        const terminal = vscode.window.createTerminal({ cwd: path.dirname(selectedNodes[0].uri.fsPath) });
                        terminal.sendText(`${input}`);
                        terminal.show();
                    }
                });
            }
        }
    });
}
exports.showModFileContextMenu = showModFileContextMenu;
//# sourceMappingURL=commands.js.map