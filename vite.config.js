"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
const plugin_react_1 = __importDefault(require("@vitejs/plugin-react"));
exports.default = (0, vite_1.defineConfig)({
    plugins: [(0, plugin_react_1.default)()],
    build: {
        outDir: 'dist/webview',
        rollupOptions: {
            input: {
                main: './src/webview/index.tsx',
            },
            output: {
                entryFileNames: 'static/js/[name].js',
                chunkFileNames: 'static/js/[name].js',
                assetFileNames: 'static/[ext]/[name].[ext]',
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map