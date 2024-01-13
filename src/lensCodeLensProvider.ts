import * as vscode from 'vscode';

export class LensCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            if (line.text.includes('lens')) {
                const range = new vscode.Range(i, 0, i, line.text.length);
                lenses.push(new vscode.CodeLens(range, { title: "Ah ha! A lens!", command: 'extension.sayHello' }));
            }
        }
        return lenses;
    }
}
