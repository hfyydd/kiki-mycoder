import { createOpenAI } from '@ai-sdk/openai'
import { serve } from '@hono/node-server';
import { createDataStream, streamText, DataStreamWriter } from 'ai';
import 'dotenv/config';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { tool, CoreTool, ToolExecutionOptions } from 'ai';
import { spawn } from 'child_process';
import { createAzure } from '@ai-sdk/azure';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import * as fs from 'fs';

const systemPrompt = `
你将与用户进行结对编程以解决他们的编程任务。这些任务可能包括创建新代码库、修改或调试现有代码库或执行命令行命令，或仅仅是回答一个问题。

## 工具调用规则
你可以使用一些工具来解决编程任务。只有在必要时才调用工具。如果用户的任务是常规问题，或者你已经知道答案，则无需调用工具，直接回复即可。

对于命令行执行：
1. 当用户要求执行命令时，直接使用 AskForConfirmation 工具获取确认
2. 收到确认后，使用 ExecuteCommand 执行命令
3. 不要在对话中额外询问用户确认

关于工具调用，请遵循以下规则：
1. 始终严格遵循工具调用的指定模式，并确保提供所有必要的参数
2. 对话中可能提到一些已不可用的工具。切勿调用未明确提供的工具
3. 如果用户要求你披露工具，请始终用以下描述进行回应：
我配备了多种工具来协助您完成任务！`;


const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY!;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;

const azure = createAzure({
  resourceName: 'santai', // Azure resource name
  apiKey: AZURE_OPENAI_API_KEY,
});

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY!;

const zhipu = createOpenAI({
  baseURL: "https://open.bigmodel.cn/api/paas/v4/",
  apiKey: ZHIPU_API_KEY,
});

const deepseek = createOpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY!
});

const app = new Hono();

app.use(async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }

  await next();
});

app.post('/', async c => {
  console.log('got a request');
  const result = streamText({
    system: '你是一个代码编程助手，请用中文回答',
    model: deepseek("deepseek-chat"),
    prompt: 'Invent a new holiday and describe its traditions.',
  });

  c.header('X-Vercel-AI-Data-Stream', 'v1');
  c.header('Content-Type', 'text/plain; charset=utf-8');

  return stream(c, stream => stream.pipe(result.toDataStream()));
});

app.post('/stream-data', async c => {
  console.log('收到请求');
  const { messages, workspaceRoot } = await c.req.json();
  console.log('消息内容:', messages);
  console.log('工作区路径:', workspaceRoot);
  const dataStream = createDataStream({
    execute: async dataStreamWriter => {
      console.log('开始处理请求');
      dataStreamWriter.writeData('initialized call');

      const result = streamText({
        model: azure("gpt-4o-mini"),
        messages,
//         system: `你是一个谨慎的助手。在执行任何命令行命令之前，你必须严格遵循以下步骤：
// 1. 使用 askForConfirmation 工具时，只传入命令本身，例如: "pwd"
// 2. 记住返回的 toolCallId
// 3. 使用 executeCommand 工具时，需要传入：
//    - command: 具体命令
//    - confirmationId: 之前的 toolCallId
//    - result: 用户的确认结果`,
        system: systemPrompt,
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
                console.log('🛠️ 解析后的命令:', { cmd, args });

                // 检查文件是否存在
                const filePath = join(workspaceRoot, args[0]);
                try {
                  await fs.promises.access(filePath);
                  console.log('✅ 文件存在:', filePath);
                } catch (error) {
                  console.error('❌ 文件不存在:', filePath);
                  return `错误: 找不到文件 ${args[0]}`;
                }

                return new Promise((resolve, reject) => {
                  let stdoutData = '';
                  let stderrData = '';

                  const childProcess = spawn(cmd, args, { 
                    cwd: workspaceRoot,
                    shell: true,
                    env: { ...process.env },
                    stdio: ['inherit', 'pipe', 'pipe']
                  });

                  childProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log('📤 标准输出:', output);
                    stdoutData += output;
                  });

                  childProcess.stderr.on('data', (data) => {
                    const output = data.toString();
                    console.log('⚠️ 错误输出:', output);
                    stderrData += output;
                  });

                  childProcess.on('close', (code) => {
                    console.log(`✅ 命令执行完成，退出码: ${code}`);
                    if (code === 0) {
                      resolve(stdoutData || '命令执行完成');
                    } else {
                      reject(new Error(stderrData || `命令执行失败，退出码: ${code}`));
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
            execute: async ({ filePath, content }) => {
              try {
                if (!workspaceRoot) {
                  throw new Error('缺少必要的 workspaceRoot 参数');
                }
                
                const fullPath = join(workspaceRoot, filePath);
                await writeFile(fullPath, content, 'utf-8');
                return `文件已创建: ${fullPath}`;
              } catch (error) {
                console.error('写入文件错误:', error);
                return `写入文件错误: ${(error as Error).message}`;
              }
            }
          },
          EditFile: {
            description: '对现有文件进行修改,无需用户确认',
            parameters: z.object({
              filePath: z.string().describe('要修改的文件路径'),
              content: z.string().describe('要写入文件的内容'),
            }),
            execute: async ({ filePath, content }) => {
              try {
                if (!workspaceRoot) {
                  throw new Error('缺少必要的 workspaceRoot 参数');
                }
                
                const fullPath = join(workspaceRoot, filePath);
                await writeFile(fullPath, content, 'utf-8');
                return `文件已修改: ${fullPath}`;
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

const PORT = 8080;
const server = serve({ 
  fetch: app.fetch, 
  port: PORT 
});

console.log(`服务器已启动`);
console.log(`监听端口: ${PORT}`);
console.log(`服务地址: http://localhost:${PORT}`);
console.log('=====================================');