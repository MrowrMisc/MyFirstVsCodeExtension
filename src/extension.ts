import * as vscode from 'vscode';
import { GutterDecorationProvider } from './gutterDecorationProvider';
import { LensCodeLensProvider } from './lensCodeLensProvider';

export function activate(context: vscode.ExtensionContext) {
    const gutterProvider = new GutterDecorationProvider(context);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'typescript' }, new LensCodeLensProvider()));

	console.log('Congratulations, your extension "vscode-specs-cpp-test-runner" is now active!');

	let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
		vscode.window.showInformationMessage('Hello World from Specs.cpp and MiniSpecs.cpp Test Runner!');
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
