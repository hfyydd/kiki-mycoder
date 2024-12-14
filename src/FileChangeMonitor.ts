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
    private codeLensProvider: vscode.Disposable | undefined;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    private changeTimeout: NodeJS.Timeout | undefined;
    private insertedLines: { line: number, originalText: string }[] = [];
    private isInserting: boolean = false;

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

        // Register CodeLens provider
        this.codeLensProvider = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
            provideCodeLenses: (document: vscode.TextDocument) => {
                const codeLenses: vscode.CodeLens[] = [];
                if (document === vscode.window.activeTextEditor?.document && this.isTracking) {
                    const currentContent = document.getText();
                    const originalLines = this.originalContent.split('\n');
                    const currentLines = currentContent.split('\n');

                    // Find all changed lines
                    for (let i = 0; i < Math.max(originalLines.length, currentLines.length); i++) {
                        if (i >= currentLines.length || i >= originalLines.length || currentLines[i] !== originalLines[i]) {
                            // Create range for the line above the change
                            const lineAbove = Math.max(0, i);
                            const range = document.lineAt(lineAbove).range;
                            
                            codeLenses.push(
                                new vscode.CodeLens(range, {
                                    title: "✓ Accept",
                                    command: "fileChangeMonitor.acceptChanges",
                                    arguments: [document.uri]
                                }),
                                new vscode.CodeLens(range, {
                                    title: "✗ Reject",
                                    command: "fileChangeMonitor.rejectChanges",
                                    arguments: [document.uri]
                                })
                            );
                            break; // Only show CodeLens for the first change
                        }
                    }
                }
                return codeLenses;
            },
            onDidChangeCodeLenses: this.onDidChangeCodeLenses
        });

        // Register document change listener
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

    private startTracking() {
        console.log('Start tracking changes...');
        this.isTracking = true;
        // 强制刷新 CodeLens
        this.refreshCodeLens();
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        console.log('文档变化事件触发');
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            // 如果是第一次变化或者还没有原始内容，设置原始内容
            if (!this.isTracking || !this.originalContent) {
                this.originalContent = editor.document.getText();
                this.startTracking();
            }
            this.lastChangeEvent = event;
            this.handleDocumentChange(editor);
        }
        this.refreshCodeLens();
    }

    private async handleDocumentChange(editor: vscode.TextEditor) {
        // 如果没有原始内容，先保存当前内容作为原始内容
        if (!this.originalContent) {
            this.originalContent = editor.document.getText();
            return;
        }

        const currentContent = editor.document.getText();
        // 如果内容没有变化，不处理
        if (this.originalContent === currentContent) {
            return;
        }

        // 确保开始跟踪
        if (!this.isTracking) {
            this.startTracking();
        }

        const originalLines = this.originalContent.split('\n');
        const currentLines = currentContent.split('\n');
        
        const changes = await this.getContentChangesFromEvent(editor, this.lastChangeEvent!);
        if (changes.added.length || changes.removed.length) {
            this.showButtons();
        } else {
            this.hideButtons();
        }
    }

    private async getContentChangesFromEvent(editor: vscode.TextEditor, event: vscode.TextDocumentChangeEvent) {
        // 如果正在插入中，直接返回
        if (this.isInserting) {
            return { added: [], removed: [] };
        }

        const added: { range: vscode.Range; originalText?: string }[] = [];
        const removed: { range: vscode.Range; originalText: string }[] = [];

        // 清空之前记录的插入位置
        this.insertedLines = [];

        try {
            // 获取当前文件的路径
            const currentFilePath = editor.document.uri.fsPath;
            const tempFilePath = currentFilePath + '.temp';
            
            // 读取.temp文件内容
            const tempFileUri = vscode.Uri.file(tempFilePath);
            const tempContent = await vscode.workspace.fs.readFile(tempFileUri);
            const tempLines = Buffer.from(tempContent).toString('utf8').split('\n');

            // 设置插入标志
            this.isInserting = true;

            for (const change of event.contentChanges) {
                const lineStart = change.range.start.line;
                if (change.text.length > 0) {
                    const endLine = change.range.start.line + change.text.split('\n').length - 1;
                    const endChar = change.text.split('\n').pop()?.length || 0;
                    added.push({
                        range: new vscode.Range(
                            change.range.start,
                            new vscode.Position(endLine, endChar)
                        ),
                        originalText: tempLines[lineStart]
                    });

                    // 在改动位置插入.temp文件中的原始文本
                    const edit = new vscode.WorkspaceEdit();
                    const document = editor.document;
                    
                    if (tempLines[lineStart]) {
                        const pos = new vscode.Position(lineStart, 0);
                        edit.insert(document.uri, pos, tempLines[lineStart] + '\n');
                        this.insertedLines.push({ line: lineStart, originalText: tempLines[lineStart] });
                        await vscode.workspace.applyEdit(edit);
                    }
                }
            }

            editor.setDecorations(this.modifiedDecorationTypes.added, added.map(item => item.range));
            editor.setDecorations(this.modifiedDecorationTypes.removed, removed.map(item => item.range));
        } catch (error) {
            console.error('Failed to read .temp file:', error);
        } finally {
            // 重置插入标志
            this.isInserting = false;
        }

        return { added, removed };
    }

    private stopTracking() {
        this.isTracking = false;
        this.originalContent = '';
        this.lastChangeEvent = undefined;

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // Clear all decorations
            editor.setDecorations(this.modifiedDecorationTypes.added, []);
            editor.setDecorations(this.modifiedDecorationTypes.removed, []);
            editor.setDecorations(this.originalTextDecoration, []);

            // Force CodeLens refresh
            this.refreshCodeLens();
        }
    }

    private refreshCodeLens() {
        if (this.changeTimeout) {
            clearTimeout(this.changeTimeout);
        }
        this.changeTimeout = setTimeout(() => {
            this._onDidChangeCodeLenses.fire();
            this.changeTimeout = undefined;
        }, 100);
    }

    public async acceptChanges() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        try {
            const document = editor.document;
            const edit = new vscode.WorkspaceEdit();
            
            // 使用记录的位置删除原始文本行
            for (const { line } of this.insertedLines) {
                const range = new vscode.Range(
                    new vscode.Position(line, 0),
                    new vscode.Position(line + 1, 0)
                );
                edit.delete(document.uri, range);
            }
            
            await vscode.workspace.applyEdit(edit);
            
            // 停止跟踪并清理
            this.stopTracking();
            this.hideButtons();
            await editor.document.save();
            this.clearDecorations(editor);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to save changes');
        }
    }

    public async rejectChanges() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.originalContent) return;

        try {
            const document = editor.document;
            const edit = new vscode.WorkspaceEdit();
            
            // 使用记录的位置删除改动的文本行（原始文本行的下一行）
            for (const { line } of this.insertedLines) {
                const range = new vscode.Range(
                    new vscode.Position(line + 1, 0),
                    new vscode.Position(line + 2, 0)
                );
                edit.delete(document.uri, range);
            }
            
            await vscode.workspace.applyEdit(edit);
            
            // 清理
            this.stopTracking();
            this.clearDecorations(editor);
            this.hideButtons();
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

    private onEditorChange(editor: vscode.TextEditor | undefined) {
        if (editor && this.isTracking) {
            this.handleDocumentChange(editor);
        }
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        if (this.codeLensProvider) {
            this.codeLensProvider.dispose();
        }
        this._onDidChangeCodeLenses.dispose();
        if (this.changeTimeout) {
            clearTimeout(this.changeTimeout);
        }
        this.actionButtons.forEach(button => button.dispose());
        this.modifiedDecorationTypes.added.dispose();
        this.modifiedDecorationTypes.removed.dispose();
        this.originalTextDecoration.dispose();
    }
}