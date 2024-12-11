import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Kiki MyCoder is now active!');

    // 注册侧边栏视图提供者
    const provider = new ChatViewProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('kiki-mycoder.chatView', provider),
        vscode.commands.registerCommand('kiki-mycoder.add', () => {
            // 现在可以通过 provider 访问 webview
            const webview = provider.getWebview();
            if (webview) {
                webview.postMessage({ type: 'newChat' });
                console.log('添加新聊天');
            }
        }),
        // 添加新的命令注册
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
                        reference: `@${fileName}#L${startLine}-${endLine}`
                    });
                }
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

        // 获取当前打开的文件路径
        const activeEditor = vscode.window.activeTextEditor;
        const currentFilePath = activeEditor ? activeEditor.document.uri.fsPath : '';

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
        webviewView.onDidDispose(() => {
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    webviewView.webview.postMessage({
                        type: 'currentFile',
                        value: editor.document.uri.fsPath
                    });
                }
            });
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
            }
        });
    }

    // 添加获取 webview 的方法
    public getWebview() {
        return this._view?.webview;
    }
}

function getWebviewContent(context: vscode.Uri, webview: vscode.Webview): string {
    // Get path to the React bundle
    const scriptPathOnDisk = vscode.Uri.file(
        path.join(context.fsPath, 'dist', 'webview', 'static', 'js', 'main.js')
    );
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

    // Create a nonce for inline script
    const nonce = generateNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src http://localhost:8080; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval' 'nonce-${nonce}';">
        <title>Kiki MyCoder</title>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
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
