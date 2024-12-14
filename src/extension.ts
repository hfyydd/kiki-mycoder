import * as vscode from 'vscode';
import * as path from 'path';
import { FileChangeMonitor } from './FileChangeMonitor';

export function activate(context: vscode.ExtensionContext) {
    console.log('Kiki MyCoder is now active!');

    // 配置自动保存为 off
    vscode.workspace.getConfiguration().update('files.autoSave', 'off', vscode.ConfigurationTarget.Workspace);

    let settingsPanel: vscode.WebviewPanel | undefined = undefined;

    // 注册侧边栏视图提供者
    const provider = new ChatViewProvider(context.extensionUri);
    
    // Register file change monitor
    const fileMonitor = FileChangeMonitor.getInstance();
    context.subscriptions.push(fileMonitor);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('kiki-mycoder.chatView', provider),
        vscode.commands.registerCommand('fileChangeMonitor.acceptChanges', () => fileMonitor.acceptChanges()),
        vscode.commands.registerCommand('fileChangeMonitor.rejectChanges', () => fileMonitor.rejectChanges()),
        vscode.commands.registerCommand('kiki-mycoder.chatView', async () => {
            // 尝试显示聊天视图
            await vscode.commands.executeCommand('workbench.view.extension.kiki-mycoder');
            provider.logWorkspaceAndEditorInfo('Open Chat View');
        }),
        vscode.commands.registerCommand('kiki-mycoder.add', () => {
            // 打印当前工作区和编辑器信息
            provider.logWorkspaceAndEditorInfo('Add New Chat');
            
            // 现在可以通过 provider 访问 webview
            const webview = provider.getWebview();
            if (webview) {
                webview.postMessage({ type: 'newChat' });
                console.log('添加新聊天');
            }
        }),
        vscode.commands.registerCommand('kiki-mycoder.insertSelectedText', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.selection;
                const text = editor.document.getText(selection);
                const startLine = selection.start.line + 1;  // VSCode 行号从0开始，显示时+1
                const endLine = selection.end.line + 1;
                const fileName = path.basename(editor.document.uri.fsPath);
                
                const webview = provider.getWebview();
                if (webview) {
                    webview.postMessage({ 
                        type: 'insertText', 
                        text: text,
                        reference: `${fileName}#L${startLine}-${endLine}`
                    });
                }
            }
        }),
        vscode.commands.registerCommand('kiki-mycoder.openSettings', () => {
            if (settingsPanel) {
                settingsPanel.reveal(vscode.ViewColumn.One);
            } else {
                settingsPanel = vscode.window.createWebviewPanel(
                    'kikiSettings',
                    'Kiki MyCoder Settings',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: [
                            vscode.Uri.file(path.join(context.extensionPath, 'dist'))
                        ]
                    }
                );

                settingsPanel.webview.html = getSettingsWebviewContent(context.extensionUri, settingsPanel.webview);

                settingsPanel.webview.onDidReceiveMessage(
                    message => {
                        switch (message.type) {
                            case 'updateSettings':
                                // 处理设置更新
                                vscode.workspace.getConfiguration('kikiMycoder').update(
                                    message.setting,
                                    message.value,
                                    vscode.ConfigurationTarget.Global
                                );
                                break;
                        }
                    },
                    undefined,
                    context.subscriptions
                );

                settingsPanel.onDidDispose(
                    () => {
                        settingsPanel = undefined;
                    },
                    null,
                    context.subscriptions
                );
            }
        })
    );
}

// 添加新的视图提供者类
class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('Chat view is being activated');
        this._view = webviewView;  // 保存 webview 引用
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        // 获取工作区根路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
        console.log('当前工作区路径:', workspaceRoot);

        // 获取当前打开的文件路径
        const activeEditor = vscode.window.activeTextEditor;
        const currentFilePath = activeEditor ? activeEditor.document.uri.fsPath : '';
        console.log('当前活动文件:', currentFilePath);
        
        // 如果有活动编辑器，打印更多信息
        if (activeEditor) {
            console.log('活动编辑器信息:', {
                fileName: path.basename(currentFilePath),
                languageId: activeEditor.document.languageId,
                lineCount: activeEditor.document.lineCount,
                selection: {
                    start: activeEditor.selection.start,
                    end: activeEditor.selection.end
                }
            });
        }

        webviewView.webview.html = getWebviewContent(this._extensionUri, webviewView.webview);

        // 发送工作区路径和当前文件路径到 webview
        webviewView.webview.postMessage({ 
            type: 'workspaceRoot', 
            value: workspaceRoot 
        });
        
        webviewView.webview.postMessage({
            type: 'currentFile',
            value: currentFilePath
        });

        // 监听文件切换事件
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                console.log('文件切换:', editor.document.uri.fsPath);
                webviewView.webview.postMessage({
                    type: 'currentFile',
                    value: editor.document.uri.fsPath
                });
            }
        });

        // 监听来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'getFiles':
                    const workspacePath = message.path;
                    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(workspacePath));
                    // 只返回文件，不返回文件夹
                    const fileNames = files
                        .filter(([_, type]) => type === vscode.FileType.File)
                        .map(([name]) => name);
                    webviewView.webview.postMessage({ 
                        type: 'fileList', 
                        files: fileNames 
                    });
                    break;
                case 'getFileContent':
                    try {
                        const filePath = path.join(workspaceRoot, message.fileName);
                        const fileUri = vscode.Uri.file(filePath);
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        webviewView.webview.postMessage({
                            type: 'fileContent',
                            fileName: message.fileName,
                            content: new TextDecoder().decode(content)
                        });
                    } catch (error) {
                        console.error('读取文件失败:', error);
                        webviewView.webview.postMessage({
                            type: 'fileContent',
                            fileName: message.fileName,
                            content: null
                        });
                    }
                    break;
            }
        });
    }

    // 添加获取 webview 的方法
    public getWebview() {
        return this._view?.webview;
    }

    // 添加打印当前工作区和活动窗口信息的方法
    public logWorkspaceAndEditorInfo(action: string) {
        console.log(`[${action}] Workspace and Editor Information:`);
        
        // 获取工作区根路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
        console.log('当前工作区路径:', workspaceRoot);

        // 获取当前打开的文件路径
        const activeEditor = vscode.window.activeTextEditor;
        const currentFilePath = activeEditor ? activeEditor.document.uri.fsPath : '';
        console.log('当前活动文件:', currentFilePath);
        
        // 如果有活动编辑器，打印更多信息
        if (activeEditor) {
            console.log('活动编辑器信息:', {
                fileName: path.basename(currentFilePath),
                languageId: activeEditor.document.languageId,
                lineCount: activeEditor.document.lineCount,
                selection: {
                    start: activeEditor.selection.start,
                    end: activeEditor.selection.end
                }
            });
        }
    }
}

function getWebviewContent(context: vscode.Uri, webview: vscode.Webview): string {
    // Get path to the React bundle
    const scriptPathOnDisk = vscode.Uri.file(
        path.join(context.fsPath, 'dist', 'webview', 'static', 'js', 'chat.js')
    );
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
    
    // Get path to the CSS file
    const cssPathOnDisk = vscode.Uri.file(
        path.join(context.fsPath, 'dist', 'webview', 'static', 'css', 'chat.css')
    );
    const cssUri = webview.asWebviewUri(cssPathOnDisk);

    // Get path to the shared client code
    const clientPathOnDisk = vscode.Uri.file(
        path.join(context.fsPath, 'dist', 'webview', 'static', 'js', 'client.BiiVQGle.js')
    );
    const clientUri = webview.asWebviewUri(clientPathOnDisk);

    // Create a nonce for inline script
    const nonce = generateNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src http://localhost:8080 ws://localhost:8080; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval' 'nonce-${nonce}';">
        <title>Kiki MyCoder</title>
        <link href="${cssUri}" rel="stylesheet">
    </head>
    <body>
        <div id="root"></div>
        <script type="module" nonce="${nonce}" src="${clientUri}"></script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}

function getSettingsWebviewContent(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'static', 'js', 'settings.js'));
    const clientUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'static', 'js', 'client.BiiVQGle.js'));
    const nonce = generateNonce();

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src http://localhost:8080 ws://localhost:8080; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval' 'nonce-${nonce}';">
            <title>Kiki MyCoder Settings</title>
        </head>
        <body>
            <div id="root"></div>
            <script type="module" nonce="${nonce}" src="${clientUri}"></script>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
}

// Generate a random nonce
function generateNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}
