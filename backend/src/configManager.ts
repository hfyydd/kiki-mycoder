import fs from 'fs/promises';
import path from 'path';

interface ProviderConfig {
  model: string;
  apiKey: string;
  resourceName?: string;
  baseURL?: string;
  enabled?: boolean;
}

interface LLMConfig {
  provider: string;
  providerConfigs: {
    [key: string]: ProviderConfig;
  };
}

interface Config {
  systemPrompt: string;
  llmConfig: LLMConfig;
}

class ConfigManager {
  private static instance: ConfigManager;
  private configPath: string;
  private promptPath: string;
  private config: Config;

  private constructor() {
    this.configPath = path.join(__dirname, 'config.json');
    this.promptPath = path.join(__dirname, 'system-prompt.txt');
    this.config = {
      systemPrompt: '',
      llmConfig: {
        provider: 'azure',
        providerConfigs: {
          azure: {
            model: 'gpt-4o-mini',
            apiKey: '',
            resourceName: '',
            enabled: false
          },
          deepseek: {
            model: '',
            apiKey: '',
            baseURL: 'https://api.deepseek.com',
            enabled: false
          },
          google: {
            model: '',
            apiKey: '',
            enabled: false
          }
        },
      },
    };
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
      ConfigManager.instance.loadConfig();
    }
    return ConfigManager.instance;
  }

  public async loadConfig() {
    try {
      // 读取 system prompt
      const systemPrompt = await fs.readFile(this.promptPath, 'utf-8');
      
      // 读取其他配置
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      const configJson = JSON.parse(configContent);

      
      this.config = {
        systemPrompt,
        llmConfig: configJson.llmConfig
      };
    } catch (error) {
      console.error('加载配置文件失败:', error);
      // 如果配置文件不存在，使用默认配置并保存
      await this.saveConfig();
    }
    return this.config;
  }

  public async saveConfig() {
    try {
      // 只保存 llmConfig
      const configJson = {
        llmConfig: this.config.llmConfig
      };
      await fs.writeFile(this.configPath, JSON.stringify(configJson, null, 2), 'utf-8');
    } catch (error) {
      console.error('保存配置文件失败:', error);
    }
  }

  public async saveSystemPrompt() {
    try {
      // 只保存 systemPrompt
      await fs.writeFile(this.promptPath, this.config.systemPrompt, 'utf-8');
    } catch (error) {
      console.error('保存system prompt失败:', error);
    }
  }

  public async updateConfig(newConfig: Partial<Config>) {
    if ('systemPrompt' in newConfig) {
      this.config.systemPrompt = newConfig.systemPrompt!;
      await this.saveSystemPrompt();
    }
    
    if ('llmConfig' in newConfig) {
      this.config.llmConfig = newConfig.llmConfig!;
      await this.saveConfig();
    }
  }

  public async updateSystemPrompt(prompt: string) {
    this.config.systemPrompt = prompt;
    await this.saveSystemPrompt();
  }

  public async updateLLMConfig(llmConfig: LLMConfig) {
    this.config.llmConfig = llmConfig;
    await this.saveConfig();
  }

  public getConfig() {
    return this.config;
  }
}

export const configManager = ConfigManager.getInstance();
