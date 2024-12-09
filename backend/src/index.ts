import { createOpenAI } from '@ai-sdk/openai'
import { serve } from '@hono/node-server';
import { createDataStream, streamText } from 'ai';
import 'dotenv/config';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { tool, CoreTool, ToolExecutionOptions } from 'ai';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createAzure } from '@ai-sdk/azure';

const execAsync = promisify(exec);

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
  const { messages } = await c.req.json();
  console.log('消息内容:', messages);
  
  const dataStream = createDataStream({
    execute: async dataStreamWriter => {
      console.log('开始处理请求');
      dataStreamWriter.writeData('initialized call');

      const result = streamText({
        model: azure("gpt-4o-mini"),
        messages,
        system: `你是一个谨慎的助手。在执行任何命令行命令之前，你必须严格遵循以下步骤：
1. 使用 askForConfirmation 工具时，只传入命令本身，例如: "pwd"
2. 记住返回的 toolCallId
3. 使用 executeCommand 工具时，需要传入：
   - command: 具体命令
   - confirmationId: 之前的 toolCallId
   - result: 用户的确认结果`,
        tools: {
          askForConfirmation: {
            description: '在执行命令前必须先调用此工具获取用户确认。调用此工具会返回 toolCallId和 result，需要记住这个 ID和 result 并在后续的 executeCommand 中使用。',
            parameters: z.object({
              message: z.string().describe('向用户展示将要执行的命令。例如："ls -la "')
            })
          },
          executeCommand: {
            description: '执行命令行命令。必须传入之前 askForConfirmation 调用时获得的 toolCallId和 result。',
            parameters: z.object({ 
              command: z.string().describe('要执行的命令行命令'),
              confirmationId: z.string().describe('必填：之前调用 askForConfirmation 时返回的 toolCallId'),
              result: z.string().describe('必填：之前调用 askForConfirmation 时返回的 result')
            }),
            execute: async ({ command, confirmationId, result }, options: ToolExecutionOptions) => {
              console.log('执行命令工具被调用:', { command, confirmationId, result });
              

              if (!confirmationId) {
                  return '错误：缺少 confirmationId 参数';
              }
              console.log('确认结果:', { result });

              if (!result) {
                  return `错误：找不到对应的确认结果 (confirmationId: ${result})`;
              }

              if (result !== 'Yes') {
                  return `用户拒绝执行命令`;
              }

              try {
                  console.log('执行命令:', command);
                  const { stdout, stderr } = await execAsync(command);
                  return stdout || stderr || '(无输出)';
              } catch (error) {
                  console.error('命令执行错误:', error);
                  return `执行错误: ${(error as Error).message}`;
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