import * as vscode from 'vscode';
import { diffLines, Change } from 'diff';
import * as path from 'path';

const DIFF_VIEW_URI_SCHEME = 'vscode-diff';

function arePathsEqual(path1: string, path2: string): boolean {
    return path.normalize(path1).toLowerCase() === path.normalize(path2).toLowerCase();
}

export class FileChangeMonitor {
    private static instance: FileChangeMonitor;
    private disposables: vscode.Disposable[] = [];
    private originalContent: string = '';
    private actionButtons: vscode.StatusBarItem[] = [];

    private codeLensProvider: vscode.Disposable | undefined;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    private changeTimeout: NodeJS.Timeout | undefined;

    private cwd: string = '';
    private relPath: string | undefined;
    private editType: 'modify' | 'create' = 'modify';

    private currentDiffEditor: vscode.TextEditor | undefined;

    private constructor() {
        console.log('FileChangeMonitor: 初始化中...');

        // 状态栏按钮
        const acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        acceptButton.text = "$(check) Accept";
        acceptButton.command = 'fileChangeMonitor.acceptChanges';

        const rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        rejectButton.text = "$(x) Reject";
        rejectButton.command = 'fileChangeMonitor.rejectChanges';

        this.actionButtons = [acceptButton, rejectButton];

        // Register CodeLens provider for both regular files and diff editor
        this.codeLensProvider = vscode.languages.registerCodeLensProvider(
            [
                { scheme: 'file' },
                { scheme: DIFF_VIEW_URI_SCHEME }  // Add support for diff editor scheme
            ],
            {
                provideCodeLenses: (document: vscode.TextDocument) => {
                    const codeLenses: vscode.CodeLens[] = [];
                    
                    // Get all visible diff editors
                    const diffEditors = vscode.window.visibleTextEditors.filter(
                        editor => editor.document.uri.scheme === 'vscode-diff'
                    );
                    
                    // Check if this document is part of a diff editor
                    const isDiffDocument = diffEditors.some(
                        editor => arePathsEqual(editor.document.uri.fsPath, document.uri.fsPath)
                    );
                    
                    if (isDiffDocument) {
                        // Find the first line with changes
                        const lines = document.getText().split('\n');
                        let lineNumber = 0;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            if (line.startsWith('+') || line.startsWith('-')) {
                                lineNumber = i;
                                break;
                            }
                        }
                        
                        const range = new vscode.Range(
                            new vscode.Position(Math.max(0, lineNumber), 0),
                            new vscode.Position(Math.max(0, lineNumber), 0)
                        );
                        
                        codeLenses.push(
                            new vscode.CodeLens(range, {
                                title: "✓ Accept Changes",
                                command: "fileChangeMonitor.acceptChanges",
                                tooltip: "Accept these changes"
                            }),
                            new vscode.CodeLens(range, {
                                title: "✗ Reject Changes",
                                command: "fileChangeMonitor.rejectChanges",
                                tooltip: "Reject these changes"
                            })
                        );
                    } else {
                        // Check if this is our current diff editor
                        if (this.currentDiffEditor && arePathsEqual(document.uri.fsPath, this.currentDiffEditor.document.uri.fsPath)) {
                            const differences = diffLines(this.originalContent || '', document.getText());
                            let lineNumber = 0;
                            
                            for (const part of differences) {
                                if (part.added || part.removed) {
                                    const range = new vscode.Range(
                                        new vscode.Position(Math.max(0, lineNumber), 0),
                                        new vscode.Position(Math.max(0, lineNumber), 0)
                                    );
                                    
                                    codeLenses.push(
                                        new vscode.CodeLens(range, {
                                            title: "✓ Accept Changes",
                                            command: "fileChangeMonitor.acceptChanges",
                                            tooltip: "Accept these changes"
                                        }),
                                        new vscode.CodeLens(range, {
                                            title: "✗ Reject Changes",
                                            command: "fileChangeMonitor.rejectChanges",
                                            tooltip: "Reject these changes"
                                        })
                                    );
                                    break; // Only show CodeLens for the first change
                                }
                                if (!part.removed) {
                                    lineNumber += part.count || 0;
                                }
                            }
                        }
                    }
                    return codeLenses;
                },
                onDidChangeCodeLenses: this.onDidChangeCodeLenses
            }
        );

        // Register document change listener
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.onEditorChange.bind(this)),
            vscode.workspace.onDidSaveTextDocument(this.onDocumentSave.bind(this))
        );
    }

    public static getInstance(): FileChangeMonitor {
        if (!FileChangeMonitor.instance) {
            FileChangeMonitor.instance = new FileChangeMonitor();
        }
        return FileChangeMonitor.instance;
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        console.log('文档变化事件触发');
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            this.handleDocumentChange(editor);
        }
        this.refreshCodeLens();
    }

    private async handleDocumentChange(editor: vscode.TextEditor) {
        // Set the current working directory and relative path
        const currentFile = editor.document.uri.fsPath;
        this.cwd = path.dirname(currentFile);
        this.relPath = path.basename(currentFile);
        this.editType = 'modify'; // Since we're handling changes to an existing file
        
        try {
            // Open the diff editor
            await this.openDiffEditor();
        } catch (error) {
            console.error('Failed to open diff editor:', error);
            vscode.window.showErrorMessage(`Failed to open diff editor: ${error}`);
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
        if (this.currentDiffEditor) {
            const document = this.currentDiffEditor.document;
            // Save the current content
            await document.save();
            // Close the diff editor
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputTextDiff) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
            this.currentDiffEditor = undefined;
            //vscode.window.showInformationMessage('Changes accepted and saved.');
        }
        this.hideButtons();
    }

    public async rejectChanges() {
        if (this.currentDiffEditor) {
            // Close the diff editor without saving
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputTextDiff) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
            this.currentDiffEditor = undefined;
            vscode.window.showInformationMessage('Changes rejected.');
        }
        this.hideButtons();
    }

    private showButtons() {
        this.actionButtons.forEach(button => button.show());
    }

    private hideButtons() {
        this.actionButtons.forEach(button => button.hide());
    }

    private onEditorChange(editor: vscode.TextEditor | undefined) {
        // TODO
    }

    private async onDocumentSave(document: vscode.TextDocument) {
        // Check if the saved document is our current diff editor
        if (this.currentDiffEditor && arePathsEqual(document.uri.fsPath, this.currentDiffEditor.document.uri.fsPath)) {
            // Close all diff editors for this file
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputTextDiff) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
            this.currentDiffEditor = undefined;
        }
    }

    public dispose(): void {
        this.currentDiffEditor = undefined;
        this.disposables.forEach(d => d.dispose());
        if (this.codeLensProvider) {
            this.codeLensProvider.dispose();
        }
        this._onDidChangeCodeLenses.dispose();
        if (this.changeTimeout) {
            clearTimeout(this.changeTimeout);
        }
        this.actionButtons.forEach(button => button.dispose());
    }

    private async openDiffEditor(): Promise<vscode.TextEditor> {
        if (!this.relPath) {
            throw new Error("No file path set");
        }
        const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath));
        const tempUri = vscode.Uri.file(`${uri.fsPath}.temp`);
        
        // If this diff editor is already open then we should activate that instead of opening a new diff
        const diffTab = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .find(
                (tab) =>
                    tab.input instanceof vscode.TabInputTextDiff &&
                    arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
            );
        if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
            const editor = await vscode.window.showTextDocument(diffTab.input.modified);
            return editor;
        }
        
        // Open new diff editor
        return new Promise<vscode.TextEditor>((resolve, reject) => {
            const fileName = path.basename(uri.fsPath);
            const fileExists = this.editType === "modify";
            const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor && arePathsEqual(editor.document.uri.fsPath, uri.fsPath)) {
                    disposable.dispose();
                    this.currentDiffEditor = editor;  // Store the current diff editor
                    resolve(editor);
                }
            });
            
            vscode.commands.executeCommand(
                "vscode.diff",
                tempUri,
                uri,
                `${fileName}: modified`,
            );

            this.showButtons();
            
            // This may happen on very slow machines
            setTimeout(() => {
                disposable.dispose();
                reject(new Error("Failed to open diff editor, please try again..."));
            }, 10_000);
        });
    }
}