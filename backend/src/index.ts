import { createOpenAI } from '@ai-sdk/openai'
import { serve } from '@hono/node-server';
import { createDataStream, streamText, DataStreamWriter, generateText } from 'ai';
import 'dotenv/config';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { tool, CoreTool, ToolExecutionOptions } from 'ai';
import { spawn } from 'child_process';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';
import { configManager } from './configManager';
import { cors } from 'hono/cors';

// const systemPrompt = `
// 你是一个专业的编程助手,将帮助用户完成代码相关任务。请按照以下工作流程处理用户请求：

// 1. 分析任务
// - 仔细理解用户的需求
// - 确定需要使用的工具

// 2. 搜索相关文件
// - 告诉用户你正在搜索相关文件
// - 使用 ViewFile 工具查看可能相关的文件
// - 向用户报告找到了哪些相关文件

// 3. 提出修改方案
// - 说明你计划如何修改代码
// - 展示具体的修改内容
// - 使用 EditFile 工具执行修改

// 4. 验证修改
// - 使用 AskForConfirmation 和 ExecuteCommand 工具运行修改后的代码
// - 展示运行结果

// 请使用中文与用户交流,保持专业、友好的语气。

// 工具使用规则：
// 1. 执行命令前必须使用 AskForConfirmation 获取确认
// 2. 文件操作(ViewFile、EditFile等)可以直接执行,无需确认
// 3. 始终准确传递所需参数
// 4. 不要调用未提供的工具`;





const app = new Hono();

// 启用 CORS
app.use('/*', cors({
  origin: '*',
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}));



app.use(async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }

  await next();
});

// 创建 LLM provider 实例的函数
const createProvider = (selectedModel?: string) => {
  const config = configManager.getConfig();
  const { providerConfigs } = config.llmConfig;

  // 如果没有指定模型，使用默认配置
  if (!selectedModel) {
    const { provider } = config.llmConfig;
    const providerConfig = providerConfigs[provider];
    
    switch (provider) {
      case 'azure':
        return createAzure({
          resourceName: providerConfig.resourceName,
          apiKey: providerConfig.apiKey,
        })(providerConfig.model);
      case 'deepseek':
        return createOpenAI({
          baseURL: "https://api.deepseek.com",
          apiKey: providerConfig.apiKey,
        })(providerConfig.model);
      case 'google':
        return createGoogleGenerativeAI({ apiKey: providerConfig.apiKey })(providerConfig.model);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // 根据模型名称判断使用哪个 provider
  if (selectedModel.startsWith('gpt')) {
    const azureConfig = providerConfigs['azure'];
    return createAzure({
      resourceName: azureConfig.resourceName,
      apiKey: azureConfig.apiKey,
    })(selectedModel);
  } else if (selectedModel.startsWith('deepseek')) {
    const deepseekConfig = providerConfigs['deepseek'];
    return createOpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: deepseekConfig.apiKey,
    })(selectedModel);
  } else if (selectedModel.startsWith('gemini')) {
    const googleConfig = providerConfigs['google'];
    return createGoogleGenerativeAI({ apiKey: googleConfig.apiKey })(selectedModel);
  }

  throw new Error(`Unsupported model: ${selectedModel}`);
};



app.post('/', async c => {
  console.log('got a request');
  const result = streamText({
    model: createProvider("gemini-1.5-flash-latest"),
    prompt: 'Invent a new holiday and describe its traditions.',
  });


  c.header('X-Vercel-AI-Data-Stream', 'v1');
  c.header('Content-Type', 'text/plain; charset=utf-8');

  return stream(c, stream => stream.pipe(result.toDataStream()));;
});

app.post('/stream-data', async c => {
  console.log('收到请求');
  const { messages, workspaceRoot, currentFile,selectedModel } = await c.req.json();
  console.log('消息内容:', messages);
  console.log('工作区路径:', workspaceRoot);
  console.log('当前文件:', currentFile);
  console.log('选择的模型:', selectedModel);

  const messagesWithContext = [
    ...messages,
    { role: 'system', content: `Current file: ${currentFile}` }
  ];
  const config = await configManager.getConfig();

  const dataStream = createDataStream({
    execute: async dataStreamWriter => {
      console.log('开始处理请求');
      dataStreamWriter.writeData('initialized call');


      const result = streamText({
        model: createProvider(selectedModel),
        messages: messages,
        system: config.systemPrompt,
        tools: {
          AskForConfirmation: {
            description: '在执行命令前必须先调用此工具获取用户确认。调用此工具会返回 toolCallId和 result，需要记住这个 ID和 result 并在后续的 ExecuteCommand 中使用。',
            parameters: z.object({
              message: z.string().describe('向用户展示将要执行的命令。例如："ls -la "，无需添加"将要执行命令:" ')
            })
          },
          ExecuteCommand: {
            description: '执行命令行命令。必须传入之前 AskForConfirmation 调用时获得的 toolCallId和 result。',
            parameters: z.object({ 
              command: z.string().describe('要执行的命令行命令'),
              result: z.string().describe('必填：之前调用 askForConfirmation 时返回的 result')
            }),
            execute: async ({ command, result }, options: ToolExecutionOptions) => {
              try {
                if (!workspaceRoot) {
                  console.log('❌ 错误：缺少工作区路径');
                  throw new Error('缺少必要的 workspaceRoot 参数');
                }

                console.log('📂 工作区路径:', workspaceRoot);
                console.log('🚀 开始执行命令:', command);

                const [cmd, ...args] = command.split(' ');
                
                return new Promise((resolve, reject) => {

                  const childProcess = spawn(cmd, args, { 
                    cwd: workspaceRoot,
                    shell: true,
                    env: { ...process.env },
                    stdio: ['inherit', 'pipe', 'pipe']
                  });

                  childProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log('📤 标准输出:', output);
                    resolve(output)
                  });

                  childProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    console.log('⚠️ 错误输出:', output);
                    resolve(output)
                  });

                  childProcess.on('close', (code) => {
                    console.log(`✅ 命令执行完成，退出码: ${code}`);
                    if (code === 0) {
                      resolve('命令执行完成');
                    } else {
                      reject(new Error(`命令执行失败，退出码: ${code}`));
                    }
                  });

                  childProcess.on('error', (err) => {
                    console.error('💥 命令执行错误:', err);
                    reject(new Error(`命令执行错误: ${err.message}`));
                  });
                });
              } catch (error) {
                console.error('💥 执行过程出错:', error);
                return `执行错误: ${(error as Error).message}`;
              }
            }
          },
          CreateDirectory: {
            description: '创建新目录',
            parameters: z.object({
              path: z.string().describe('要创建的目录路径')
            }),
            execute: async ({ path}) => {
              try {
                const fullPath = join(workspaceRoot, path);
                await fs.promises.mkdir(fullPath, { recursive: true });
                return `目录已创建: ${fullPath}`;
              } catch (error) {
                console.error('创建目录错误:', error);
                return `创建目录错误: ${(error as Error).message}`;
              }
            }
          },
          ViewFile: {
            description: '查看文件内容',
            parameters: z.object({
              filePath: z.string().describe('要查看的文件路径')
            }),
            execute: async ({ filePath }) => {
              try {
                //如果 filePath 为空,则使用当前文件路径
                if (!filePath) {
                  filePath = currentFile;
                }

                const fullPath = join(workspaceRoot, filePath);
                const content = await readFile(fullPath, 'utf-8');
                return content;
              } catch (error) {
                console.error('读取文件错误:', error);
                return `读取文件错误: ${(error as Error).message}`;
              }
            }
          },
          ViewCodeItem: {
            description: '显示特定代码项，例如函数或类的定义',
            parameters: z.object({
              filePath: z.string().describe('文件路径'),
              itemName: z.string().describe('代码项名称')
            }),
            execute: async ({ filePath, itemName }) => {
              try {
                const fullPath = join(workspaceRoot, filePath);
                const content = await readFile(fullPath, 'utf-8');
                const regex = new RegExp(`(function|class)\\s+${itemName}\\s*\\(`);
                const match = content.match(regex);
                if (match) {
                  return `找到代码项: ${match[0]}`;
                } else {
                  return `未找到代码项: ${itemName}`;
                }
              } catch (error) {
                console.error('读取文件错误:', error);
                return `读取文件错误: ${(error as Error).message}`;
              }
            }
          },
          WriteFile: {
            description: '创建并写入新文件,无需用户确认',
            parameters: z.object({
              filePath: z.string().describe('要创建的文件路径'),
              content: z.string().describe('要写入文件的内容'),
            }),
            execute: async ({ filePath, content,Instruction, }) => {
              try {
                //如果 filePath 为空,则使用当前文件路径
                if (!filePath) {
                  filePath = currentFile;
                }
                if (!workspaceRoot) {
                  throw new Error('缺少必要的 workspaceRoot 参数');
                }
                
                const fullPath = join(workspaceRoot, filePath);
                await writeFile(fullPath, content, 'utf-8');
                return fullPath;
              } catch (error) {
                console.error('写入文件错误:', error);
                return `写入文件错误: ${(error as Error).message}`;
              }
            }
          },
          EditFile: {
            description: '对现有文件进行修改,可以精确控制修改位置',
            parameters: z.object({
              filePath: z.string().describe('要修改的文件路径'),
              content: z.string().describe('要写入的内容'),
            }),
            execute: async ({ filePath, content}) => {
              console.log("Edited ")
              try {
                if (!filePath) {
                  filePath = currentFile;
                }

                if (!workspaceRoot) {
                  throw new Error('缺少必要的 workspaceRoot 参数');
                }
                
                const fullPath = join(workspaceRoot, filePath);
                
                // 保存原始文件内容到临时文件
                const originalContent = await readFile(fullPath, 'utf-8');
                const tempFilePath = `${fullPath}.temp`;
                await writeFile(tempFilePath, originalContent, 'utf-8');
                
                // 写入新内容
                await writeFile(fullPath, content, 'utf-8');
                
                return filePath;
              } catch (error) {
                console.error('修改文件错误:', error);
                return `修改文件错误: ${(error as Error).message}`;
              }
            }
          }
        }
      });
      result.mergeIntoDataStream(dataStreamWriter);
    },
    onError: error => {
      console.error('流处理错误:', error);
      return error instanceof Error ? error.message : String(error);
    }
  });

  c.header('X-Vercel-AI-Data-Stream', 'v1');
  c.header('Content-Type', 'text/plain; charset=utf-8');

  return stream(c, stream => stream.pipe(dataStream));
});



// 统一的 webview 消息处理
app.post('/api/webview/message', async (c) => {
  try {
    const { type, provider, field, value } = await c.req.json();
    
    switch (type) {
      case 'updateConfig':
        const { provider, field, value } = await c.req.json();
        
        if (!provider) {
          return c.json({ error: 'Missing provider' }, 400);
        }

        if (provider === 'systemPrompt') {
          if (typeof value !== 'string') {
            return c.json({ error: 'Invalid system prompt value' }, 400);
          }
          await configManager.updateSystemPrompt(value);
          return c.json({ success: true });
        }
        
        if (!field) {
          return c.json({ error: 'Missing field for provider config' }, 400);
        }

        const config = configManager.getConfig();
        if (provider === 'azure') {
          if (!(field in config.llmConfig.providerConfigs.azure)) {
            return c.json({ error: `Invalid field for azure provider: ${field}` }, 400);
          }
          (config.llmConfig.providerConfigs.azure as any)[field] = value;
          await configManager.updateLLMConfig(config.llmConfig);
        } else {
          if (!(provider in config.llmConfig.providerConfigs)) {
            return c.json({ error: `Invalid provider: ${provider}` }, 400);
          }
          config.llmConfig.providerConfigs[provider] = {
            ...config.llmConfig.providerConfigs[provider],
            [field]: value
          };
          await configManager.updateLLMConfig(config.llmConfig);
        }
        return c.json({ success: true });
      case 'getConfig':
        return c.json(configManager.getConfig());
        
      case 'verifyKey':
        try {
          if (!provider) {
            throw new Error('Provider is required');
          }
          // TODO: 实现实际的 key 验证逻辑
          return c.json({ success: true });
        } catch (error) {
          return c.json({ success: false, error: (error as Error).message });
        }
        
      default:
        return c.json({ error: 'Invalid message type' }, 400);
    }
  } catch (error) {
    console.error('Error processing webview message:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

const PORT = 8080;
const server = serve({ 
  fetch: app.fetch, 
  port: PORT 
});

console.log(`服务器已启动`);
console.log(`监听端口: ${PORT}`);
console.log(`服务地址: http://localhost:${PORT}`);
console.log('=====================================');