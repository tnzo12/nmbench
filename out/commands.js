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
    vscode.window.showQuickPick(['execute', 'Command 2', 'Command 3'])
        .then(selectedCommand => {
        if (selectedCommand) {
            if (selectedCommand === 'execute') {
                vscode.window.showQuickPick([
                    { label: 'Option 1', description: '-rplots=2' },
                    { label: 'Option 2', description: '-anotherOption' },
                    { label: 'Option 3', description: '-thirdOption' }
                ], {
                    canPickMany: true,
                    placeHolder: 'Select options to add'
                }).then(selectedOptions => {
                    const optionsString = selectedOptions ? selectedOptions.map(opt => opt.description).join(' ') : '';
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
            else {
                let defaultCommandSyntax = '';
                switch (selectedCommand) {
                    case 'Command 2':
                        defaultCommandSyntax = `Default command syntax for Command 2 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
                        break;
                    case 'Command 3':
                        defaultCommandSyntax = `Default command syntax for Command 3 ${selectedNodes.map(node => path.basename(node.uri.fsPath)).join(' ')}`;
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