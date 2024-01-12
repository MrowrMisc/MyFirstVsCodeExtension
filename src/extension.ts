// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

class LensCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            if (line.text.includes('lens')) {
                const range = new vscode.Range(i, 0, i, 0);
                lenses.push(new vscode.CodeLens(range, { title: "Ah ha! A lens!", command: 'extension.sayHello' }));
            }
        }
        return lenses;
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-specs-cpp-test-runner" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('vscode-specs-cpp-test-runner.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Specs.cpp and MiniSpecs.cpp Test Runner!');
	});

	context.subscriptions.push(disposable);

	context.subscriptions.push(vscode.languages.registerCodeLensProvider('typescript', new LensCodeLensProvider()));
}

// This method is called when your extension is deactivated
export function deactivate() {}
