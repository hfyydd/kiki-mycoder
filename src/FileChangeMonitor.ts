import * as vscode from 'vscode';

export class FileChangeMonitor {
    private static instance: FileChangeMonitor;
    private disposables: vscode.Disposable[] = [];
    private originalContent: string = '';
    private modifiedDecorationTypes: {
        added: vscode.TextEditorDecorationType;
        removed: vscode.TextEditorDecorationType;
    };
    private originalTextDecoration: vscode.TextEditorDecorationType;
    private actionButtons: vscode.StatusBarItem[] = [];
    private isTracking: boolean = false;
    private lastChangeEvent?: vscode.TextDocumentChangeEvent;

    private constructor() {
        console.log('FileChangeMonitor: 初始化中...');

        // 定义装饰类型
        this.modifiedDecorationTypes = {
            added: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: { id: "diffEditor.insertedLineBackground" },
                outlineWidth: "1px",
                outlineStyle: "solid",
                outlineColor: { id: "diffEditor.insertedTextBorder" },
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
              }),
            removed: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: { id: "diffEditor.removedLineBackground" },
                outlineWidth: "1px",
                outlineStyle: "solid",
                outlineColor: { id: "diffEditor.removedTextBorder" },
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
              })
        };

        // 添加显示原始行内容的装饰器
        this.originalTextDecoration = vscode.window.createTextEditorDecorationType({
            
                isWholeLine: true,
                color: "#808080",
                outlineWidth: "1px",
                outlineStyle: "solid",
                outlineColor: { id: "diffEditor.removedTextBorder" },
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            
        });

        // 状态栏按钮
        const acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        acceptButton.text = "$(check) Accept";
        acceptButton.command = 'fileChangeMonitor.acceptChanges';

        const rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        rejectButton.text = "$(x) Reject";
        rejectButton.command = 'fileChangeMonitor.rejectChanges';

        this.actionButtons = [acceptButton, rejectButton];

        // 监听文档变化
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.onEditorChange.bind(this))
        );
    }

    public static getInstance(): FileChangeMonitor {
        if (!FileChangeMonitor.instance) {
            FileChangeMonitor.instance = new FileChangeMonitor();
        }
        return FileChangeMonitor.instance;
    }

    private startTracking(editor: vscode.TextEditor) {
        if (!this.isTracking && editor.document) {
            console.log('开始追踪文件:', editor.document.fileName);
            this.originalContent = editor.document.getText();
            console.log('原始内容长度:', this.originalContent.length);
            this.isTracking = true;
        }
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        console.log('文档变化事件触发');
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            this.lastChangeEvent = event;
            this.handleDocumentChange(editor);
        }
    }

    private onEditorChange(editor: vscode.TextEditor | undefined) {
        console.log('编辑器切换事件触发');
        if (editor) {
            this.startTracking(editor);
        }
        this.hideButtons();
    }

    private handleDocumentChange(editor: vscode.TextEditor) {
        if (!this.isTracking) {
            this.startTracking(editor);
            return;
        }

        const currentContent = editor.document.getText();
        if (this.lastChangeEvent) {
            const changes = this.getContentChangesFromEvent(editor, this.lastChangeEvent);
            if (changes.added.length || changes.removed.length) {
                this.showButtons();
            } else {
                this.hideButtons();
            }
        }
    }

    private getContentChangesFromEvent(editor: vscode.TextEditor, event: vscode.TextDocumentChangeEvent) {
        const added: { range: vscode.Range; originalText?: string }[] = [];
        const removed: { range: vscode.Range; originalText: string }[] = [];

        event.contentChanges.forEach(change => {
            const originalText = this.originalContent.substring(change.rangeOffset, change.rangeOffset + change.rangeLength);
            if (change.rangeLength > 0) {
                removed.push({
                    range: change.range,
                    originalText
                });
            }
            if (change.text.length > 0) {
                const endLine = change.range.start.line + change.text.split('\n').length - 1;
                const endChar = change.text.split('\n').pop()?.length || 0;
                added.push({
                    range: new vscode.Range(
                        change.range.start,
                        new vscode.Position(endLine, endChar)
                    ),
                    originalText: change.rangeLength > 0 ? originalText : undefined
                });
            }
        });

        // 应用装饰器显示原始文本
        const originalTextDecorations = [...added, ...removed].map(item => {
            const lineIndex = item.range.start.line;
            const originalLines = this.originalContent.split('\n');
            const originalLineContent = lineIndex < originalLines.length ? originalLines[lineIndex] : '';
            const startPos = new vscode.Position(lineIndex, 0);
            const endPos = new vscode.Position(lineIndex, 0);
            return {
                range: new vscode.Range(startPos, endPos),
                renderOptions: {
                    after: {
                        contentText: originalLineContent || '',
                        color: '#888',
                        margin: '0 0 0 0'
                    }
                }
            };
        });

        //editor.setDecorations(this.originalTextDecoration, originalTextDecorations);
        editor.setDecorations(this.modifiedDecorationTypes.added, added.map(item => item.range));
        editor.setDecorations(this.modifiedDecorationTypes.removed, removed.map(item => item.range));

        return { added, removed };
    }

    public async acceptChanges() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        try {
            await editor.document.save();
            this.originalContent = editor.document.getText();
            this.clearDecorations(editor);
            this.hideButtons();
            vscode.window.showInformationMessage('Changes accepted and saved successfully');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save changes');
        }
    }

    public async rejectChanges() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        try {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                editor.document.uri,
                new vscode.Range(0, 0, editor.document.lineCount, 0),
                this.originalContent
            );
            await vscode.workspace.applyEdit(edit);
            this.clearDecorations(editor);
            this.hideButtons();
            vscode.window.showInformationMessage('Changes rejected successfully');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to reject changes');
        }
    }

    private showButtons() {
        this.actionButtons.forEach(button => button.show());
    }

    private hideButtons() {
        this.actionButtons.forEach(button => button.hide());
    }

    private clearDecorations(editor: vscode.TextEditor) {
        if (this.modifiedDecorationTypes) {
            editor.setDecorations(this.modifiedDecorationTypes.added, []);
            editor.setDecorations(this.modifiedDecorationTypes.removed, []);
        }
        editor.setDecorations(this.originalTextDecoration, []);
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.actionButtons.forEach(button => button.dispose());
        Object.values(this.modifiedDecorationTypes).forEach(d => d.dispose());
        this.originalTextDecoration.dispose();
    }
}