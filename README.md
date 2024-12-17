# Kiki-MyCoder VSCode Extension

A VSCode extension inspired by Winsurf, providing AI-powered coding assistance right in your editor.

一个受 Winsurf 启发的 VSCode 扩展，为您提供 AI 驱动的编码辅助功能。

## Features 功能

- AI-powered code completion and suggestions
- Natural language to code conversion
- Code explanation and documentation
- Smart code refactoring suggestions

## Tech Stack 技术栈

- Frontend (前端)
  - React
  - VSCode Extension API
  - Vercel AI SDK
- Backend (后端)
  - Hono
  - Node.js

## Installation 安装

1. Clone the repository
   ```bash
   git clone [https://github.com/hfyydd/kiki-mycoder.git]
   ```

2. Install dependencies
   ```bash
   # Install frontend dependencies
   pnpm install

   # Install backend dependencies
   cd backend
   pnpm install
   ```

## Development 开发

### Frontend (VSCode Extension)
The frontend needs to be run within VSCode:

1. Open the project in VSCode
2. Press F5 to start debugging
3. A new VSCode window will open with the extension loaded

### Backend
Navigate to the backend directory and run:
```bash
cd backend
pnpm dev
```

## Project Structure 项目结构

```
kiki-mycoder/
├── src/              # Frontend source code
├── backend/          # Backend server code
├── package.json      # Frontend dependencies
└── README.md         # This file
```

## Contributing 贡献

Feel free to submit issues and enhancement requests!

## License 许可

[MIT License](LICENSE)
