import React, { useRef, useEffect, useState } from 'react';
import { useChat } from 'ai/react';
import { Message } from 'ai/react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';  // 暗色主题
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import './ChatPanel.css';
import { v4 as uuidv4 } from 'uuid';

import { LoadingIndicator } from './components/LoadingIndicator';
import path from 'path';

const API_BASE_URL = 'http://localhost:8080';

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

// interface Message {
//     id: string;
//     role: 'user' | 'assistant';
//     content: string;
//     toolInvocations?: ToolInvocation[];
// }

// 处理消息内容的组件
const MessageContent = ({ content, role }: { content: string, role: 'user' | 'assistant' | 'system' | 'data' }) => {
    // 分割代码块和普通文本
    const parts = content.split(/(```[\s\S]*?```)/);

    return (
        <div className="message-content">
            {parts.map((part, index) => {
                if (part.startsWith('```') && part.endsWith('```')) {
                    // 提取代码和语言
                    const codeMatch = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                    if (codeMatch) {
                        const language = codeMatch[1] || 'plaintext';
                        const code = codeMatch[2].trim();
                        return <CodeBlock key={index} content={code} language={language} />;
                    }
                }
                // 普通文本
                return (
                    <div key={index} className="text-content">
                        {part}
                        {role === 'assistant' && <span className="cursor" />}
                    </div>
                );
            })}
        </div>
    );
};

// 添加代码高亮组件
const CodeBlock = ({ content, language = 'plaintext' }: { content: string, language?: string }) => {
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

    const languageDetected = detectLanguage(content);

    return (
        <pre className="code-block">
            <code className={`language-${languageDetected}`}>
                {content}
            </code>
        </pre>
    );
};

interface ApiConfig {
    model: string;
    apiKey: string;
    resourceName?: string;
    baseURL?: string;
    enabled?: boolean;
}

interface LLMConfig {
    providerConfigs: {
        azure?: ApiConfig;
        deepseek?: ApiConfig;
        google?: ApiConfig;
        ollama?: ApiConfig;
    };
}

// Model selector component
const ModelSelector = ({ onSelect }: { onSelect: (model: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [models, setModels] = useState<{ provider: string; model: string }[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const popupRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/webview/message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ type: 'getConfig' }),
                });
                const data = await response.json();

                const config = data as { llmConfig: LLMConfig };
                
                const availableModels = [];
                if (config.llmConfig.providerConfigs.azure?.enabled) {
                    
                    availableModels.push({
                        provider: 'azure',
                        model: config.llmConfig.providerConfigs.azure.model
                    });
                }
                if (config.llmConfig.providerConfigs.deepseek?.enabled) {
                    availableModels.push({
                        provider: 'deepseek',
                        model: config.llmConfig.providerConfigs.deepseek.model
                    });
                }
                if (config.llmConfig.providerConfigs.google?.enabled) {
                    availableModels.push({
                        provider: 'google',
                        model: config.llmConfig.providerConfigs.google.model
                    });
                }
                if (config.llmConfig.providerConfigs.ollama?.enabled) {
                    availableModels.push({
                        provider: 'ollama',
                        model: config.llmConfig.providerConfigs.ollama.model
                    });
                }
                setModels(availableModels);
                if (availableModels.length > 0) {
                    setSelectedModel(availableModels[0].model);
                    onSelect(availableModels[0].model);
                }
            } catch (error) {
                console.error('Error fetching config:', error);
            }
        };
        fetchConfig();
    }, [onSelect]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleModelSelect = (model: string) => {
        setSelectedModel(model);
        onSelect(model);
        setIsOpen(false);
    };

    return (
        <div className="model-selector">
            <div className="selected-model" onClick={() => setIsOpen(!isOpen)}>
                <span className="model-icon">^</span>
                <span className="model-name">{selectedModel || 'Select Model'}</span>
            </div>
            {isOpen && (
                <div className="model-popup" ref={popupRef}>
                    {models.map((model, index) => (
                        <div
                            key={index}
                            className={`model-option ${model.model === selectedModel ? 'selected' : ''}`}
                            onClick={() => handleModelSelect(model.model)}
                        >
                            {model.model}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

function ChatPanel() {
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
    const [selectedModel, setSelectedModel] = useState<string>('');
    const processedContentRef = useRef('');
    const { messages, input, handleInputChange, handleSubmit, addToolResult, isLoading, setMessages } = useChat({
        api:  'http://localhost:8080/stream-data',
        maxSteps: 5,
        fetch: async (url, options) => {
            const customParams = {
                workspaceRoot: workspaceRoot,
                currentFile: currentFile,
                selectedModel: selectedModel
            };
            
            const body = JSON.parse((options!.body as string) || "{}");
            if (processedContentRef.current) {
                body.messages[body.messages.length - 1].content = processedContentRef.current;
            }
            options!.body = JSON.stringify({
                ...body,
                ...customParams,
            });
            console.log('🛠️ body:', options!.body);

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

    const fetchDirectories = async () => {
        try {
            // 通过 vscode API 获取文件夹列表
            vscode.postMessage({ 
                type: 'getDirectories',
                path: workspaceRoot
            });
        } catch (error) {
            console.error('获取文件夹列表失败:', error);
        }
    }

    const handleDropdownItemClick = (item: { id: string, label: string }) => {
        if (item.id === 'files') {
            setDropdownType('files');
            fetchFiles();
        } else if (item.id === 'directories') {
            setDropdownType('directories');
            fetchDirectories();
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
        console.log('handleSubmit2 开始执行');
        e.preventDefault();
        
        console.log('当前input值:', input);
        console.log('当前tempText:', tempText);
        
        // 提取所有@文件引用
        const regex = /@([^\s]+)/g;
        const matches = input.match(regex) || [];
        const fileRefs = matches.filter(ref => !tempText[ref]); // 只处理未在tempText中的引用
        
        // 处理提交的文本，替换引用为实际内容
        let processedInput = input;
        
        // 先处理已经在tempText中的引用
        Object.entries(tempText).forEach(([reference, text]) => {
            console.log('正在处理已有引用:', reference);
            const fileExt = reference.slice(1).split('.').pop() || '';
            const language = getLanguageFromExt(fileExt);
            processedInput = processedInput.replace(
                reference,
                `\n\n文件 ${reference} 的内容：\n\`\`\`${language}\n${text}\n\`\`\`\n`
            );
        });
        
        // 处理新的文件引用
        if (fileRefs.length > 0) {
            for (const ref of fileRefs) {
                const fileName = ref.slice(1); // 去掉@
                try {
                    // 请求文件内容
                    vscode.postMessage({
                        type: 'getFileContent',
                        fileName: fileName
                    });
                    
                    // 等待响应
                    const content = await new Promise<string>((resolve, reject) => {
                        const handler = (event: MessageEvent) => {
                            const message = event.data;
                            if (message.type === 'fileContent' && message.fileName === fileName) {
                                window.removeEventListener('message', handler);
                                if (message.content === null) {
                                    reject(new Error(`无法读取文件 ${fileName}`));
                                } else {
                                    resolve(message.content);
                                }
                            }
                        };
                        window.addEventListener('message', handler);
                        // 5秒超时
                        setTimeout(() => {
                            window.removeEventListener('message', handler);
                            reject(new Error('获取文件内容超时'));
                        }, 5000);
                    });
                    
                    // 替换文件引用
                    const fileExt = fileName.split('.').pop() || '';
                    const language = getLanguageFromExt(fileExt);
                    processedInput = processedInput.replace(
                        ref,
                        `\n\n文件 ${fileName} 的内容：\n\`\`\`${language}\n${content}\n\`\`\`\n`
                    );
                } catch (error) {
                    console.error(`处理文件 ${fileName} 失败:`, error);
                }
            }
        }
        
        console.log('处理后的文本:', processedInput);
        processedContentRef.current = processedInput;
        
        // 使用处理后的文本提交
        //handleInputChange({ target: { value: processedInput } } as React.ChangeEvent<HTMLInputElement>);
        
        // 清空临时存储
        setTempText({});

        
        try {
            await handleSubmit(e);
            console.log('handleSubmit 执行完成');
        } catch (error) {
            console.error('提交时发生错误:', error);
        }
    };

    // 根据文件扩展名获取语言标识
    const getLanguageFromExt = (ext: string): string => {
        const languageMap: { [key: string]: string } = {
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'py': 'python',
            'json': 'json',
            'html': 'html',
            'css': 'css',
            'md': 'markdown'
        };
        return languageMap[ext.toLowerCase()] || '';
    };

    return (
        <div className="chat-container">
            <div className="messages">
                {messages.map((message) => (
                    <div key={message.id} className={`message ${message.role}`}>
                        <MessageContent content={message.content} role={message.role} />
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
                ))}
                {isLoading && <LoadingIndicator />}
                <div ref={messagesEndRef} />
            </div>
            <div className="input-container">
                <ModelSelector onSelect={setSelectedModel} />
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
                
                .cursor {
                    display: inline-block;
                    width: 2px;
                    height: 14px;
                    background-color: #d4d4d4;
                    animation: blink 1s infinite;
                }
                
                @keyframes blink {
                    0% {
                        opacity: 0;
                    }
                    50% {
                        opacity: 1;
                    }
                    100% {
                        opacity: 0;
                    }
                }
                
                .model-selector {
                    position: relative;
                    margin-bottom: 8px;
                    color: var(--vscode-input-placeholderForeground);
                    font-size: 13px;
                }

                .selected-model {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 3px;
                }



                .model-icon {
                    font-size: 12px;
                    color: var(--vscode-input-placeholderForeground);
                }

                .model-name {
                    color: var(--vscode-input-placeholderForeground);
                }

                .model-popup {
                    position: absolute;
                    bottom: 100%;
                    left: 0;
                    min-width: 150px;
                    background-color: var(--vscode-dropdown-background);
                    border-radius: 3px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    z-index: 1000;
                    margin-bottom: 4px;
                    padding: 4px 0;
                }

                .model-option {
                    padding: 4px 8px;
                    cursor: pointer;
                    color: var(--vscode-dropdown-foreground);
                }



                .model-option.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
            `}</style>
        </div>
    );
}

export default ChatPanel;
