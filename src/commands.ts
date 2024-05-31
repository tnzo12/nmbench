import * as vscode from 'vscode';
import * as path from 'path';

export function showModFileContextMenu(treeView: vscode.TreeView<vscode.TreeItem>) {
    const selectedNodes = treeView.selection as vscode.TreeItem & { uri: vscode.Uri }[];
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
                } else {
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