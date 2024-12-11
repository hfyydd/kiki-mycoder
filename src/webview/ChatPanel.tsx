import React, { useRef, useEffect, useState } from 'react';
import { useChat } from 'ai/react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';  // 暗色主题
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';

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

// 添加代码高亮组件
const CodeBlock = ({ content }: { content: string }) => {
    useEffect(() => {
        Prism.highlightAll();
    }, [content]);

    // 检测代码语言
    const detectLanguage = (code: string): string => {
        if (code.includes('interface ') || code.includes('type ')) return 'typescript';
        if (code.includes('def ') || code.includes('import ')) return 'python';
        if (code.includes('function ') || code.includes('const ')) return 'javascript';
        return 'plaintext';
    };

    const language = detectLanguage(content);

    return (
        <pre className="code-block">
            <code className={`language-${language}`}>
                {content}
            </code>
        </pre>
    );
};

export function ChatPanel() {
    const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
    const [currentFile, setCurrentFile] = useState<string>('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [dropdownItems] = useState([
        { id: 'code', label: 'Code Context Items' },
        { id: 'files', label: 'Files' },
        { id: 'directories', label: 'Directories' }
    ]);
    const [files, setFiles] = useState<string[]>([]);
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [dropdownType, setDropdownType] = useState<string | null>(null);
    const { messages, input, handleInputChange, handleSubmit, addToolResult, isLoading, setMessages } = useChat({
        api: 'http://localhost:8080/stream-data',
        maxSteps: 5,
        fetch: async (url, options) => {
            const customParams = {
                workspaceRoot: workspaceRoot,
                currentFile: currentFile
            };
            
            const body = JSON.parse((options!.body as string) || "{}");
            options!.body = JSON.stringify({
                ...body,
                ...customParams,
            });

            return fetch(url, options);
        },
        async onToolCall({ toolCall }) {
            console.log('🛠️ 工具调用:', toolCall);
            console.log('🛠️ 工作区路径:', workspaceRoot);
            console.log('🛠️ 当前文件:', currentFile);
        },
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [tempText, setTempText] = useState<{[key: string]: string}>({});

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'workspaceRoot') {
                setWorkspaceRoot(message.value);
            } else if (message.type === 'currentFile') {
                setCurrentFile(message.value);
            } else if (message.type === 'newChat') {
                setMessages([]);
            } else if (message.type === 'fileList') {
                setFiles(message.files);
            } else if (message.type === 'insertText') {
                // 存储实际文本到临时存储中
                const newTempText = {...tempText};
                newTempText[message.reference] = message.text;
                setTempText(newTempText);
                
                // 只在输入框中显示引用
                const newInput = input + message.reference + ' ';
                handleInputChange({ target: { value: newInput } } as React.ChangeEvent<HTMLInputElement>);
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, [setMessages, input, tempText]);

    const handleInputChange2 = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (value.endsWith('@')) {
            setShowDropdown(true);
        } else {
            setShowDropdown(false);
        }
        handleInputChange(e);
    };

    // 获取当前文件夹下的文件列表
    const fetchFiles = async () => {
        try {
            // 通过 vscode API 获取文件列表
            vscode.postMessage({ 
                type: 'getFiles', 
                path: workspaceRoot 
            });
        } catch (error) {
            console.error('获取文件列表失败:', error);
        }
    };

    const handleDropdownItemClick = (item: { id: string, label: string }) => {
        if (item.id === 'files') {
            setDropdownType('files');
            fetchFiles();
        } else {
            setDropdownType(null);
            setShowDropdown(false);
        }
    };

    const handleFileSelect = (fileName: string) => {
        const newInput = input.slice(0, -1) + '@' + fileName + ' ';
        handleInputChange({ target: { value: newInput } } as React.ChangeEvent<HTMLInputElement>);
        setShowDropdown(false);
        setDropdownType(null);
    };

    const handleSubmit2 = async (e: React.FormEvent) => {
        console.log('handleSubmit2 开始执行');  // 检查函数是否被调用
        e.preventDefault();
        
        console.log('当前input值:', input);  // 检查当前输入值
        console.log('当前tempText:', tempText);  // 检查临时存储的内容
        
        // 处理提交的文本，替换引用为实际内容
        let processedInput = input;
        Object.entries(tempText).forEach(([reference, text]) => {
            console.log('正在处理引用:', reference);  // 检查每个引用的处理
            processedInput = processedInput.replace(reference, `\n\`\`\`\n${text}\n\`\`\`\n`);
        });
        console.log('处理后的文本:', processedInput);  // 确保这行会执行
        
        // 使用处理后的文本提交
        handleInputChange({ target: { value: processedInput } } as React.ChangeEvent<HTMLInputElement>);
        
        // 清空临时存储
        setTempText({});
        
        try {
            // 最后才调用原始的 handleSubmit
            await handleSubmit(e);
            console.log('handleSubmit 执行完成');  // 检查是否完成提交
        } catch (error) {
            console.error('提交时发生错误:', error);  // 捕获可能的错误
        }
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

                                if (toolInvocation.toolName === 'ViewFile') {
                                    return 'result' in toolInvocation ? (
                                        <div key={toolCallId} className="tool-invocation">
                                            工具调用 {`${toolInvocation.toolName}: `}
                                            <CodeBlock content={toolInvocation.result} />
                                        </div>
                                    ) : (
                                        <div key={toolCallId} className="tool-invocation">
                                            正在查看<span className="loading-dots">...</span>
                                        </div>
                                    );
                                }
                                if (toolInvocation.toolName === 'EditFile' || toolInvocation.toolName === 'WriteFile') {
                                    return 'result' in toolInvocation ? (
                                        <div key={toolCallId} className="tool-invocation">
                                            <div className="edit-header">
                                                <span className="edit-dot">•</span>
                                                <span>Edited</span>
                                                <span className="filename">{toolInvocation.result}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div key={toolCallId} className="tool-invocation">
                                            正在编辑<span className="loading-dots">...</span>
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
                <form onSubmit={handleSubmit2} className="input-form">
                    <input
                        value={input}
                        onChange={handleInputChange2}
                        placeholder="Ask anything (⌘L), @ to mention, ⌃ to select"
                        className="chat-input"
                    />
                    {showDropdown && (
                        <div className="dropdown-menu">
                            {dropdownType === 'files' ? (
                                files.map(file => (
                                    <div 
                                        key={file} 
                                        className="dropdown-item"
                                        onClick={() => handleFileSelect(file)}
                                    >
                                        {file}
                                    </div>
                                ))
                            ) : (
                                dropdownItems.map(item => (
                                    <div 
                                        key={item.id} 
                                        className="dropdown-item"
                                        onClick={() => handleDropdownItemClick(item)}
                                    >
                                        {item.label}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </form>
            </div>
            <style>{`
                .chat-container {
                    height: 100%;
                    min-height: 100%;
                    display: flex;
                    flex-direction: column;
                    background: var(--vscode-sideBar-background);
                    color: var(--vscode-sideBar-foreground);
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                }
                .messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0.5rem;
                    margin-bottom: 60px;
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
                    padding: 0.5rem;
                    background: var(--vscode-sideBar-background);
                    border-top: 1px solid var(--vscode-sideBar-border);
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                }
                .input-form {
                    display: flex;
                    gap: 0.5rem;
                }
                .chat-input {
                    width: 100%;
                    padding: 0.5rem;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    color: var(--vscode-input-foreground);
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

                .code-block {
                    background: #1e1e1e;
                    border-radius: 4px;
                    padding: 1rem;
                    margin: 0.5rem 0;
                    overflow-x: auto;
                    font-family: 'Fira Code', 'Courier New', Courier, monospace;
                }

                .code-block code {
                    white-space: pre;
                    font-size: 14px;
                    line-height: 1.5;
                }

                /* Prism 主题覆盖样式 */
                :not(pre) > code[class*="language-"],
                pre[class*="language-"] {
                    background: #1e1e1e;
                }

                .token.comment,
                .token.prolog,
                .token.doctype,
                .token.cdata {
                    color: #6a9955;
                }

                .token.function {
                    color: #dcdcaa;
                }

                .token.keyword {
                    color: #569cd6;
                }

                .token.string {
                    color: #ce9178;
                }

                .token.number {
                    color: #b5cea8;
                }

                .dropdown-menu {
                    position: absolute;
                    bottom: 100%;
                    left: 0;
                    right: 0;
                    background: var(--vscode-dropdown-background);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 4px;
                    margin: 4px;
                    max-height: 200px;
                    overflow-y: auto;
                }

                .dropdown-item {
                    padding: 8px 12px;
                    cursor: pointer;
                    color: var(--vscode-dropdown-foreground);
                }

                .dropdown-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }

                .loading-dots {
                    display: inline-block;
                    animation: dotsAnimation 1.4s infinite;
                    letter-spacing: 2px;
                }

                @keyframes dotsAnimation {
                    0%, 20% { content: '.'; }
                    40% { content: '..'; }
                    60% { content: '...'; }
                    80%, 100% { content: ''; }
                }

                .edit-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 4px 8px;
                    background: rgba(30, 30, 30, 0.8);
                    border-radius: 4px;
                    color: var(--vscode-foreground);
                }

                .edit-dot {
                    color: var(--vscode-foreground);
                    opacity: 0.6;
                }

                .filename {
                    color: rgba(255, 255, 255, 0.6);
                    font-family: monospace;
                }
            `}</style>
        </div>
    );
}
