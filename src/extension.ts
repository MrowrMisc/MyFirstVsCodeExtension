import * as vscode from 'vscode';
import { GutterDecorationProvider } from './gutterDecorationProvider';
import { LensCodeLensProvider } from './lensCodeLensProvider';

function runAllTests() {}

export function activate(context: vscode.ExtensionContext) {
    const gutterProvider = new GutterDecorationProvider(context);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'typescript' }, new LensCodeLensProvider()));

	console.log('Congratulations, your extension "vscode-specs-cpp-test-runner" is now active!');

	let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
		vscode.window.showInformationMessage('Hello World from Specs.cpp and MiniSpecs.cpp Test Runner!');
	});
	context.subscriptions.push(disposable);

	const testController = vscode.tests.createTestController('specs-cpp', 'Specs.cpp Test Runner');
	context.subscriptions.push(testController);

	testController.createRunProfile('All Tests', vscode.TestRunProfileKind.Run, runAllTests);
	testController.createRunProfile('Debug All Tests', vscode.TestRunProfileKind.Debug, runAllTests);
	testController.createRunProfile('Current File', vscode.TestRunProfileKind.Run, runAllTests);
	testController.createRunProfile('Debug Current File', vscode.TestRunProfileKind.Debug, runAllTests);

	const test1 = testController.createTestItem('test-id-1', 'Test 1', vscode.Uri.file('/path/to/test-1.cpp'));
	const test2 = testController.createTestItem('test-id-2', 'Test 2', vscode.Uri.file('/path/to/test-2.cpp'));
	const test3 = testController.createTestItem('test-id-3', 'Test 3', vscode.Uri.file('/path/to/test-3.cpp'));

	testController.items.add(test1);
	testController.items.add(test2);
	testController.items.add(test3);
}

export function deactivate() {}
