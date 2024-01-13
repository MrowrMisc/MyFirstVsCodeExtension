import * as vscode from 'vscode';

export class GutterDecorationProvider {
    private gutterDecorationType: vscode.TextEditorDecorationType;
    private activeEditor: vscode.TextEditor | undefined;
    private timeout: NodeJS.Timer | undefined;

    constructor(private context: vscode.ExtensionContext) {
        // TODO: how to ship / embed images?
        this.gutterDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath('resources/images/owl-4073873_640.png'),
            gutterIconSize: 'contain'
        });

        this.activeEditor = vscode.window.activeTextEditor;
        this.registerEventListeners();
    }

    private registerEventListeners() {
        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.activeEditor = editor;
            if (editor) {
                this.triggerUpdateDecorations();
            }
        }, null, this.context.subscriptions);

        vscode.workspace.onDidChangeTextDocument(event => {
            if (this.activeEditor && event.document === this.activeEditor.document) {
                this.triggerUpdateDecorations();
            }
        }, null, this.context.subscriptions);
    }

    private triggerUpdateDecorations() {
        if (this.timeout) {
            // clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        this.timeout = setTimeout(() => this.updateDecorations(), 500);
    }

    private updateDecorations() {
        if (!this.activeEditor) {
            return;
        }

        const regEx = /gutter/g;
        const text = this.activeEditor.document.getText();
        const gutterDecorations: vscode.DecorationOptions[] = [];

        let match;
        while ((match = regEx.exec(text))) {
            const startPos = this.activeEditor.document.positionAt(match.index);
            const endPos = this.activeEditor.document.positionAt(match.index + match[0].length);
            const decoration = { 
                range: new vscode.Range(startPos, endPos),
                hoverMessage: 'Ah ha! A gutter!'
            };
            gutterDecorations.push(decoration);
        }

        this.activeEditor.setDecorations(this.gutterDecorationType, gutterDecorations);
    }
}
