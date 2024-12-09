import React, { useRef, useEffect, useState } from 'react';
import { useChat } from 'ai/react';

import { LoadingIndicator } from './components/LoadingIndicator';

declare global {
    interface Window {
        vscodeApi: any;
        acquireVsCodeApi: () => any;
    }
}

if (!window.vscodeApi) {
    window.vscodeApi = window.acquireVsCodeApi();
}

const vscode = window.vscodeApi;

interface ToolInvocation {
    id: string;
    toolName: string;
    args: any;
    toolCallId: string;
    data?: string[];
    result?: string;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolInvocations?: ToolInvocation[];
}

export function ChatPanel() {
    const [workspaceRoot, setWorkspaceRoot] = useState<string>('');

    useEffect(() => {
        // 只监听消息
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            console.log('收到消息:', message); // 调试日志
            if (message.type === 'workspaceRoot') {
                setWorkspaceRoot(message.value);
                console.log('设置工作区路径:', message.value); // 调试日志
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    const { messages, input, handleInputChange, handleSubmit, addToolResult, isLoading } = useChat({
        api: 'http://localhost:8080/stream-data',
        maxSteps: 5,
        fetch: async (url, options) => {
            const customParams = {
              workspaceRoot: workspaceRoot,
            };
      
            // 修改请求体，添加自定义参数
            const body = JSON.parse((options!.body as string) || "{}");
            options!.body = JSON.stringify({
              ...body,
              ...customParams,
            });
      
            // 发送请求
            return fetch(url, options);
        },
        async onToolCall({ toolCall }) {
            console.log('🛠️ 工具调用:', toolCall);
            console.log('🛠️ 工作区路径:', workspaceRoot);
        },
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);


    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    return (
        <div className="chat-container">
            <div className="messages">
                {messages.map((message) => (
                    <div key={message.id} className={`message ${message.role}`}>
                        <div className="message-content">
                            {message.content}
                            {message.toolInvocations?.map((toolInvocation) => {
                                const toolCallId = toolInvocation.toolCallId;
                                const addResult = (result: string) =>
                                    addToolResult({ toolCallId, result });

                                // 确认工具的渲染
                                if (toolInvocation.toolName === 'AskForConfirmation') {
                                    const currentToolCallId = toolInvocation.toolCallId;
                                    return (
                                        <div key={currentToolCallId} className="tool-invocation confirmation-dialog">
                                            <h3>Suggested terminal command</h3>
                                            <div className="command-line">
                                                <span className="command-prompt">$</span>
                                                <span className="command-text">
                                                    {toolInvocation.args.message}
                                                </span>
                                            </div>
                                            <p>Do you want to run this command?</p>
                                            <div className="tool-buttons">
                                                {'result' in toolInvocation ? (
                                                    <b>{toolInvocation.result}</b>
                                                ) : (
                                                    <>
                                                        <button 
                                                            className="accept-button"
                                                            onClick={() => addResult('Yes')}
                                                        >
                                                            Accept
                                                        </button>
                                                        <button 
                                                            className="reject-button"
                                                            onClick={() => addResult('No')}
                                                        >
                                                            Reject
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }

                                // 命令行工具的渲染
                                if (toolInvocation.toolName === 'ExecuteCommand') {
                                    console.log('命令执行数据:', toolInvocation);
                                    return (
                                        <div key={toolInvocation.toolCallId} className="tool-invocation">
                                            <div className="command-line">
                                                <span className="command-prompt">$</span>
                                                <span className="command-text">
                                                    {toolInvocation.args.command}
                                                </span>
                                            </div>
                                            <pre className="command-result">
                                                {(() => {
                                                    try {
                                                        const result = (toolInvocation as any).result;
                                                        if (typeof result === 'string') {
                                                            const parsed = JSON.parse(result);
                                                            if (parsed.type === 'stderr') {
                                                                return <span className="error-output">{parsed.content}</span>;
                                                            }
                                                            return parsed.content || result;
                                                        }
                                                        return result || '执行中...';
                                                    } catch (e) {
                                                        return (toolInvocation as any).result || '执行中...';
                                                    }
                                                })()}
                                            </pre>
                                        </div>
                                    );
                                }


                                // 其他工具的渲染
                                return 'result' in toolInvocation ? (
                                    <div key={toolCallId} className="tool-invocation">
                                        工具调用 {`${toolInvocation.toolName}: `}
                                        {toolInvocation.result}
                                    </div>
                                ) : (
                                    <div key={toolCallId} className="tool-invocation">
                                        正在调用 {toolInvocation.toolName}...
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={messagesEndRef} />
            </div>
            <div className="input-container">
                <form onSubmit={handleSubmit} className="input-form">
                    <input
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Ask anything (⌘L), @ to mention, ⌃ to select"
                        className="chat-input"
                    />
                </form>
            </div>
            <style>{`
                .chat-container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    background: #1e1e1e;
                    color: #d4d4d4;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                }
                .messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1rem;
                }
                .message {
                    margin: 0.5rem 0;
                    padding: 0.5rem 1rem;
                }
                .message-content {
                    font-size: 14px;
                    line-height: 1.5;
                    white-space: pre-wrap;
                }
                .message.user {
                    background: transparent;
                    color: #d4d4d4;
                }
                .message.assistant {
                    background: transparent;
                    color: #d4d4d4;
                }
                .input-container {
                    border-top: 1px solid #333;
                    padding: 1rem;
                    background: #1e1e1e;
                }
                .input-form {
                    display: flex;
                    gap: 0.5rem;
                }
                .chat-input {
                    width: 100%;
                    padding: 0.75rem 1rem;
                    background: #2d2d2d;
                    border: 1px solid #404040;
                    border-radius: 6px;
                    color: #d4d4d4;
                    font-size: 14px;
                    outline: none;
                    transition: border-color 0.2s;
                }
                .chat-input:focus {
                    border-color: #0078d4;
                }
                .chat-input::placeholder {
                    color: #808080;
                }
                .tool-invocation {
                    margin-top: 0.5rem;
                    padding: 0.5rem;
                    background: #2d2d2d;
                    border-radius: 4px;
                }
                
                .tool-buttons {
                    margin-top: 0.5rem;
                    display: flex;
                    gap: 0.5rem;
                }
                
                .tool-buttons button {
                    padding: 0.25rem 1rem;
                    background: #0078d4;
                    border: none;
                    border-radius: 4px;
                    color: white;
                    cursor: pointer;
                }
                
                .tool-buttons button:hover {
                    background: #106ebe;
                }
                .command-line {
                    font-family: 'Courier New', Courier, monospace;
                    background: #1a1a1a;
                    padding: 0.5rem;
                    border-radius: 4px;
                    margin-bottom: 0.5rem;
                }

                .command-prompt {
                    color: #858585;
                    margin-right: 0.5rem;
                }

                .command-text {
                    color: #cccccc;
                }

                .command-result {
                    font-family: 'Courier New', Courier, monospace;
                    white-space: pre-wrap;
                    color: #9cdcfe;
                    background: #1a1a1a;
                    padding: 0.5rem;
                    border-radius: 4px;
                    margin-top: 0.5rem;
                    overflow-x: auto;
                    max-height: 300px;
                    overflow-y: auto;
                }

                .confirmation-dialog {
                    background: #2d2d2d;
                    border-radius: 8px;
                    padding: 16px;
                    margin: 10px 0;
                }

                .confirmation-dialog h3 {
                    margin: 0 0 16px 0;
                    font-size: 16px;
                    font-weight: normal;
                }

                .confirmation-dialog p {
                    margin: 16px 0;
                }

                .accept-button {
                    background: #0078d4;
                    color: white;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }

                .reject-button {
                    background: transparent;
                    color: #d4d4d4;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }

                .tool-buttons {
                    display: flex;
                    gap: 8px;
                }
            `}</style>
        </div>
    );
}
