import React, { useState, useEffect } from 'react';

interface ApiKeyConfig {
    systemPrompt: string;

    azure: {
        resourceName: string;
        model: string;
        apiKey: string;
        enabled: boolean;
    };
    deepseek: {
        model: string;
        apiKey: string;
        baseURL: string;
        enabled: boolean;
    };
}

type ProviderConfig = ApiKeyConfig[keyof Omit<ApiKeyConfig, 'systemPrompt'>];

const API_BASE_URL = 'http://localhost:8080';

function SettingsPanel() {
    const [config, setConfig] = useState<ApiKeyConfig>({
        systemPrompt: '',
        azure: {
            resourceName: '',
            model: 'gpt-4o-mini',
            apiKey: '',
            enabled: false
        },
        deepseek: {
            model: '',
            apiKey: '',
            baseURL: '',
            enabled: false
        }
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

    useEffect(() => {
        // Load initial config
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/webview/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ type: 'getConfig' })
            });
            if (!response.ok) throw new Error('Failed to fetch config');
            const data = await response.json();
            
            
            // 转换后端配置结构为前端所需的结构
            const frontendConfig = {
                systemPrompt: data.systemPrompt,
                openai: {
                    apiKey: data.llmConfig.providerConfigs.openai?.apiKey || '',
                    baseUrl: data.llmConfig.providerConfigs.openai?.baseURL || ''
                },
                anthropic: {
                    apiKey: data.llmConfig.providerConfigs.anthropic?.apiKey || ''
                },
                google: {
                    apiKey: data.llmConfig.providerConfigs.google?.apiKey || ''
                },
                azure: {
                    resourceName: data.llmConfig.providerConfigs.azure?.resourceName || '',
                    model: data.llmConfig.providerConfigs.azure?.model || '',
                    apiKey: data.llmConfig.providerConfigs.azure?.apiKey || '',
                    enabled: data.llmConfig.providerConfigs.azure?.enabled || false
                },
                deepseek: {
                    model: data.llmConfig.providerConfigs.deepseek?.model || '',
                    apiKey: data.llmConfig.providerConfigs.deepseek?.apiKey || '',
                    baseURL: data.llmConfig.providerConfigs.deepseek?.baseURL || '',
                    enabled: data.llmConfig.providerConfigs.deepseek?.enabled || false
                }
            };
            
            
            setConfig(frontendConfig);
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    const handleConfigChange = async (provider: keyof ApiKeyConfig, field: string, value: string | boolean) => {
        // 更新本地状态
        setConfig(prev => {
            if (provider === 'systemPrompt') {
                return {
                    ...prev,
                    systemPrompt: value as string
                };
            }
            
            return {
                ...prev,
                [provider]: {
                    ...prev[provider as keyof Omit<ApiKeyConfig, 'systemPrompt'>],
                    [field]: value
                }
            };
        });

        // 保存到后端
        try {
            setIsSaving(true);
            setSaveStatus('saving');
            
            const response = await fetch(`${API_BASE_URL}/api/webview/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'updateConfig',
                    provider: provider === 'systemPrompt' ? 'systemPrompt' : provider,
                    field: provider === 'systemPrompt' ? undefined : field,
                    value
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to save config');
            }

            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (error) {
            console.error('Error saving config:', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };



    return (
        <div className="settings-container">
            <div className="settings-section">
                <div className="header">
                    <div className="header-with-status">

                        <h1>Settings</h1>
                        <span className={`save-status ${saveStatus}`}>
                            {saveStatus === 'saving' ? 'Saving...' : 
                             saveStatus === 'success' ? 'Saved ✓' : 
                             saveStatus === 'error' ? 'Error!' : ''}
                        </span>
                    </div>
                </div>

                <h2>System Prompt</h2>
                <p className="description">
                    Configure the system prompt that defines the AI assistant's behavior and capabilities.
                </p>
                <div className="system-prompt-group">
                    <textarea
                        placeholder="Enter system prompt"
                        value={config.systemPrompt}
                        onChange={(e) => handleConfigChange('systemPrompt', '', e.target.value)}
                        rows={10}
                    />
                </div>




                <div className="azure-section">
                    <div className="section-header">
                        <div className="header-with-status">

                            <h2>Azure OpenAI</h2>
                            <select 
                                className={`enable-select ${config.azure.enabled ? 'enabled' : 'disabled'}`}
                                value={config.azure.enabled ? 'enabled' : 'disabled'}
                                onChange={(e) => handleConfigChange('azure', 'enabled', e.target.value === 'enabled')}
                            >
                                <option value="enabled">Enabled</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                    </div>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Resource Name"
                            value={config.azure.resourceName}
                            onChange={(e) => handleConfigChange('azure', 'resourceName', e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Model Name"
                            value={config.azure.model}
                            onChange={(e) => handleConfigChange('azure', 'model', e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="password"
                            placeholder="API Key"
                            value={config.azure.apiKey}
                            onChange={(e) => handleConfigChange('azure', 'apiKey', e.target.value)}
                        />
                    </div>
                </div>

                <div className="deepseek-section">
                    <div className="section-header">
                        <div className="header-with-status">
                            <h2>Deepseek</h2>
                            <select 
                                className={`enable-select ${config.deepseek.enabled ? 'enabled' : 'disabled'}`}
                                value={config.deepseek.enabled ? 'enabled' : 'disabled'}
                                onChange={(e) => handleConfigChange('deepseek', 'enabled', e.target.value === 'enabled')}
                            >
                                <option value="enabled">Enabled</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                    </div>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Base URL"
                            value={config.deepseek.baseURL}
                            onChange={(e) => handleConfigChange('deepseek', 'baseURL', e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Model Name"
                            value={config.deepseek.model}
                            onChange={(e) => handleConfigChange('deepseek', 'model', e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="password"
                            placeholder="API Key"
                            value={config.deepseek.apiKey}
                            onChange={(e) => handleConfigChange('deepseek', 'apiKey', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <style>{`
                .settings-container {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    height: 100vh;
                    overflow-y: auto;
                }

                .settings-section {
                    max-width: 800px;
                    margin: 0 auto;
                }

                h2 {
                    font-size: 18px;
                    font-weight: 500;
                    margin: 24px 0 12px;
                }

                .description {
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 16px;
                    font-size: 14px;
                }

                .link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }

                .link:hover {
                    text-decoration: underline;
                }

                .input-group {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                }

                input {
                    flex: 1;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 8px 12px;
                    border-radius: 4px;
                    font-size: 14px;
                }

                .verify-btn {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }

                .verify-btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .azure-section,
                .deepseek-section {
                    margin-bottom: 32px;
                    margin-top: 32px;
                    padding: 24px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 8px;
                }

                .section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }

                .toggle-switch {
                    position: relative;
                    width: 40px;
                    height: 20px;
                }

                .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }

                .toggle-switch label {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: var(--vscode-input-background);
                    transition: .4s;
                    border-radius: 34px;
                }

                .toggle-switch label:before {
                    position: absolute;
                    content: "";
                    height: 16px;
                    width: 16px;
                    left: 2px;
                    bottom: 2px;
                    background-color: var(--vscode-input-foreground);
                    transition: .4s;
                    border-radius: 50%;
                }

                .toggle-switch input:checked + label {
                    background-color: #2196F3;
                }

                .toggle-switch input:checked + label:before {
                    transform: translateX(20px);
                }

                .azure-fields {
                    display: grid;
                    gap: 16px;
                    margin-top: 16px;
                }

                .field {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .field label {
                    font-size: 14px;
                    color: var(--vscode-foreground);
                }

                .saved-indicator {
                    margin-top: 10px;
                    font-size: 14px;
                    color: ${saveStatus === 'error' ? 'var(--vscode-errorForeground)' : 'var(--vscode-gitDecoration-addedResourceForeground)'};
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                }

                .save-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.2s;
                    min-width: 120px;
                }

                .save-button:hover:not(:disabled) {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .save-button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .save-button.saving {
                    background-color: var(--vscode-button-secondaryBackground);
                }

                .save-button.success {
                    background-color: var(--vscode-gitDecoration-addedResourceForeground);
                }

                .save-button.error {
                    background-color: var(--vscode-gitDecoration-deletedResourceForeground);
                }

                h1 {
                    font-size: 24px;
                    font-weight: 500;
                    margin: 0;
                }

                .system-prompt-group {
                    margin-bottom: 24px;
                }

                textarea {
                    width: 100%;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 12px;
                    border-radius: 4px;
                    font-size: 14px;
                    font-family: var(--vscode-editor-font-family);
                    resize: vertical;
                }

                textarea:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }

                .header-with-status {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .save-status {
                    font-size: 12px;
                    padding: 2px 8px;
                    border-radius: 4px;
                    background-color: transparent;
                }

                .save-status.saving {
                    color: var(--vscode-textLink-foreground);
                }

                .save-status.success {
                    color: var(--vscode-gitDecoration-addedResourceForeground);
                }

                .save-status.error {
                    color: var(--vscode-errorForeground);
                }

                .enable-select {
                    padding: 4px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--vscode-input-border);
                    font-size: 12px;
                    cursor: pointer;
                    margin-left: 10px;
                }

                .enable-select.enabled {
                    background-color: var(--vscode-gitDecoration-addedResourceForeground);
                    color: white;
                }

                .enable-select.disabled {
                    background-color: var(--vscode-gitDecoration-deletedResourceForeground);
                    color: white;
                }

                .enable-select:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }

                .header-with-status {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    width: 100%;
                }
            `}</style>
        </div>
    );
}

export default SettingsPanel;
