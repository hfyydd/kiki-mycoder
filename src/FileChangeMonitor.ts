import * as vscode from 'vscode';
import { diffLines, Change } from 'diff';

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
    private processedLines: Set<number> = new Set();

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
                // 在 provideCodeLenses 方法中
                const codeLenses: vscode.CodeLens[] = [];
                if (document === vscode.window.activeTextEditor?.document && this.isTracking) {
                    const currentContent = document.getText();
                    
                    // 使用 diff 算法比较内容
                    const differences = diffLines(this.originalContent, currentContent);
                    let lineNumber = 0;
                    
                    for (const part of differences) {
                        if (part.added || part.removed) {
                            // 在变更处创建 CodeLens
                            const range = document.lineAt(Math.max(0, lineNumber)).range;
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
                            break; // 如果只想显示第一处变更，保留 break
                        }
                        // 更新行号
                        if (!part.removed) {
                            lineNumber += part.count || 0;
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

        const added: { range: vscode.Range }[] = [];
        const removed: { range: vscode.Range }[] = [];

        try {
            // 获取当前文件的路径
            const currentFilePath = editor.document.uri.fsPath;
            const tempFilePath = currentFilePath + '.temp';
            const tempFileUri = vscode.Uri.file(tempFilePath);
            
            // 检查.temp文件是否存在
            try {
                await vscode.workspace.fs.stat(tempFileUri);
            } catch {
                // 如果.temp文件不存在，直接返回
                return { added, removed };
            }
            
            // 读取.temp文件内容（原始内容）
            const tempContent = await vscode.workspace.fs.readFile(tempFileUri);
            const oldText = Buffer.from(tempContent).toString('utf8');

            // 获取当前内容
            const newText = editor.document.getText();


            // 使用 diff 库计算差异
            const differences = diffLines(oldText, newText);
            
            console.log('Diff comparison results:');
            differences.forEach((part: Change, index: number) => {
                console.log(`Part ${index}:`, {
                    added: part.added || false,
                    removed: part.removed || false,
                    value: part.value,
                    count: part.count
                });
            });

            // 设置插入标志
            this.isInserting = true;
            
            let currentLine = 0;
            const edit = new vscode.WorkspaceEdit();
            
            // 记录每个差异块的信息
            const diffBlocks: { start: number, numRed: number, numGreen: number, processed: boolean }[] = [];
            let currentBlock: { start: number, numRed: number, numGreen: number, processed: boolean } | undefined;
            
            // 第一次遍历，计算差异块
            differences.forEach((part: Change) => {
                const lines = part.value.split('\n');
                const lineCount = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);

                if (part.added || part.removed) {
                    if (!currentBlock) {
                        currentBlock = {
                            start: currentLine,
                            numRed: 0,
                            numGreen: 0,
                            processed: false
                        };
                    }

                    if (part.added && currentBlock) {
                        currentBlock.numGreen += lineCount;
                    } else if (part.removed && currentBlock) {
                        currentBlock.numRed += lineCount;
                    }
                } else if (currentBlock) {
                    diffBlocks.push(currentBlock);
                    currentBlock = undefined;
                }

                if (!part.added) {
                    currentLine += lineCount;
                }
            });

            if (currentBlock) {
                diffBlocks.push(currentBlock);
            }
            
            // 打印差异块信息
            console.log('Diff Blocks:', JSON.stringify(diffBlocks, null, 2));

            // 重置计数器
            currentLine = 0;

            // 第二次遍历，处理装饰器和插入原始内容
            differences.forEach((part: Change) => {
                const lines = part.value.split('\n');
                const lineCount = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);

                if (part.removed) {
                    // 找到当前行所在的差异块
                    const block = diffBlocks.find(b => 
                        currentLine >= b.start && 
                        currentLine < b.start + b.numRed + b.numGreen &&
                        !b.processed
                    );

                    if (block) {
                        // 在差异块的起始位置插入原始内容
                        lines.forEach((line, i) => {
                            if (line || i < lines.length - 1) {
                                const insertPosition = block.start + i;
                                // 检查是否已经在这个位置插入过
                                if (!this.insertedLines.some(il => il.line === insertPosition)) {
                                    const pos = new vscode.Position(insertPosition, 0);
                                    edit.insert(editor.document.uri, pos, line + '\n');
                                    this.insertedLines.push({ line: insertPosition, originalText: line });
                                    
                                    // 为原始内容添加删除装饰器
                                    const range = new vscode.Range(pos, new vscode.Position(insertPosition + 1, 0));
                                    removed.push({ range });
                                }
                            }
                        });
                        block.processed = true;
                    }
                } else if (part.added) {
                    // 为新增内容添加添加装饰器
                    const range = new vscode.Range(
                        new vscode.Position(currentLine, 0),
                        new vscode.Position(currentLine + lineCount, lines[lineCount - 1].length)
                    );
                    added.push({ range });
                }

                if (!part.added) {
                    currentLine += lineCount;
                }
            });   

            

            // 应用编辑
            if (removed.length > 0) {
                await vscode.workspace.applyEdit(edit);
            }

            // 应用装饰器
            editor.setDecorations(this.modifiedDecorationTypes.added, added.map(item => item.range));
            editor.setDecorations(this.modifiedDecorationTypes.removed, removed.map(item => item.range));

            // 刷新 CodeLens
            this.refreshCodeLens();
            
            // 如果有任何改动，显示按钮
            if (added.length > 0 || removed.length > 0) {
                this.showButtons();
            }

        } catch (error) {
            console.error('Diff comparison error:', error);
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
        this.processedLines.clear();  // 清除处理记录

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