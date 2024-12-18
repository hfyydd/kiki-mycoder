import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export class ServerManager {
    private static instance: ServerManager;
    private serverProcess: ChildProcess | null = null;
    private port: number = 8080; // 默认端口
    private static readonly CHANNEL_NAME = 'Kiki Server';
    private outputChannel: vscode.OutputChannel | null = null;

    private constructor() {}

    static getInstance(): ServerManager {
        if (!ServerManager.instance) {
            ServerManager.instance = new ServerManager();
        }
        return ServerManager.instance;
    }

    private getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel(ServerManager.CHANNEL_NAME);
        }
        return this.outputChannel;
    }

    private log(message: string) {
        const timestamp = new Date().toLocaleTimeString();
        this.getOutputChannel().appendLine(`[${timestamp}] ${message}`);
    }

    async startServer(context: vscode.ExtensionContext): Promise<void> {
        if (this.serverProcess) {
            this.log('Server is already running');
            return;
        }

        try {
            // 获取后端服务的路径
            const serverPath = path.join(context.extensionPath, 'dist', 'backend', 'index.bundle.mjs');
            
            // 设置环境变量
            const env = {
                ...process.env,
                PORT: this.port.toString(),
                NODE_ENV: 'production'
            };

            this.getOutputChannel().show(true);
            this.log('Starting backend server...');
            this.log(`Server path: ${serverPath}`);
            this.log(`Port: ${this.port}`);

            // 启动 Node.js 进程
            this.serverProcess = spawn('node', [serverPath], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // 处理服务器输出
            this.serverProcess.stdout?.on('data', (data) => {
                this.log(`${data.toString().trim()}`);
            });

            this.serverProcess.stderr?.on('data', (data) => {
                this.log(`Error: ${data.toString().trim()}`);
            });

            this.serverProcess.on('error', (error) => {
                this.log(`Failed to start server: ${error.message}`);
                this.serverProcess = null;
            });

            this.serverProcess.on('close', (code) => {
                this.log(`Server process exited with code ${code}`);
                this.serverProcess = null;
            });

            // 等待服务器启动
            await this.waitForServerStart();
            
            this.log(`Backend server started on port ${this.port}`);
        } catch (error) {
            this.log(`Error starting server: ${error}`);
            throw error;
        }
    }

    private waitForServerStart(): Promise<void> {
        return new Promise((resolve) => {
            // 简单延迟以确保服务器启动
            setTimeout(resolve, 1000);
        });
    }

    stopServer(): void {
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
            this.log('Backend server stopped');
        }
    }

    getServerUrl(): string {
        return `http://localhost:${this.port}`;
    }

    dispose() {
        this.stopServer();
        if (this.outputChannel) {
            this.outputChannel.dispose();
            this.outputChannel = null;
        }
    }
}
