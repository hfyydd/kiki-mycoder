import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Kiki MyCoder is now active!');

    // Register the command
    const disposable = vscode.commands.registerCommand('kiki-mycoder.openChat', () => {
        // 获取当前工作区的根路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
        console.log('🛠️ 工作区根路径:', workspaceRoot);
        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'kikiMyCoder',
            'Kiki MyCoder',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'dist'))
                ]
            }
        );

        // Set webview content
        panel.webview.html = getWebviewContent(context, panel.webview);

        // 立即发送工作区路径到 webview
        panel.webview.postMessage({ 
            type: 'workspaceRoot', 
            value: workspaceRoot 
        });

    
    });

    context.subscriptions.push(disposable);
}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    // Get path to the React bundle
    const scriptPathOnDisk = vscode.Uri.file(
        path.join(context.extensionPath, 'dist', 'webview', 'static', 'js', 'main.js')
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
