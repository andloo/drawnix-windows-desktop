/**
 * 桌面版渲染层构建配置。
 *
 * 关键点：**这个文件不 import 任何第三方包**。
 * 因此它可以放在桌面仓库里、由 `--config` 传给上游的 vite，而配置里的插件解析
 * 不依赖桌面仓库自己的 node_modules —— 所有依赖统一用上游那一套，避免 React
 * 被装成两份导致 hooks 报错。
 *
 * 真正让"零补丁"成立的是 resolve.alias：把上游唯一收口的文件能力模块
 * browser-fs-access 换成 desktop/shims/fs-desktop.ts。
 *
 * 环境变量由 scripts/build-renderer.js 注入：
 *   DRAWNIX_UPSTREAM  上游仓库根目录（绝对路径）
 *   DRAWNIX_OUT_DIR   产物输出目录（绝对路径）
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..');

const upstreamEnv = process.env.DRAWNIX_UPSTREAM;
if (!upstreamEnv) {
  throw new Error('DRAWNIX_UPSTREAM 未设置，请通过 npm run build:renderer 调用');
}

const UPSTREAM_DIR = path.resolve(upstreamEnv);
const UPSTREAM_MODULES = path.join(UPSTREAM_DIR, 'node_modules');
const WEB_ROOT = path.join(UPSTREAM_DIR, 'apps', 'web');
const OUT_DIR = process.env.DRAWNIX_OUT_DIR
  ? path.resolve(process.env.DRAWNIX_OUT_DIR)
  : path.join(REPO_ROOT, 'dist', 'apps', 'web');

export default {
  // root 指向桌面自己的 entry 目录：index.html 必须在 root 内，产物才会落在
  // dist/apps/web/index.html 而不是一个相对路径。上游源码通过下面的 alias 引入。
  root: path.join(DESKTOP_DIR, 'entry'),
  base: '/',
  publicDir: path.join(WEB_ROOT, 'public'),
  cacheDir: path.join(REPO_ROOT, '.cache', 'vite'),
  clearScreen: false,
  logLevel: 'info',

  server: {
    port: 7201,
    strictPort: true,
    host: 'localhost',
    // dev server 的 root 在桌面仓库，需要显式允许读取上游源码目录
    fs: { allow: [REPO_ROOT, UPSTREAM_DIR] },
  },

  plugins: [
    {
      // dev 模式下 CSP 会拦住 HMR 的 websocket，只在 serve 时移除该 meta
      name: 'drawnix-desktop-dev-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/, '');
      },
    },
  ],

  // 不引入 @vitejs/plugin-react：生产构建只需要 esbuild 的自动 JSX 运行时。
  // 这样配置零外部依赖，也就不会和上游的插件版本互相牵制。
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },

  resolve: {
    alias: [
      // ★ 桌面适配的全部秘密：文件能力模块整体替换
      {
        find: /^browser-fs-access$/,
        replacement: path.join(DESKTOP_DIR, 'shims', 'fs-desktop.ts'),
      },
      // 上游 monorepo 的 workspace 包（等价于上游 tsconfig.base.json 的 paths）
      {
        find: /^@drawnix\/drawnix$/,
        replacement: path.join(UPSTREAM_DIR, 'packages', 'drawnix', 'src', 'index.ts'),
      },
      {
        find: /^@plait-board\/react-board$/,
        replacement: path.join(UPSTREAM_DIR, 'packages', 'react-board', 'src', 'index.ts'),
      },
      {
        find: /^@plait-board\/react-text$/,
        replacement: path.join(UPSTREAM_DIR, 'packages', 'react-text', 'src', 'index.ts'),
      },
      // 上游 Web 壳的全局样式（body/#root 尺寸、overflow 等），跟着上游一起演进
      {
        find: /^@drawnix-desktop\/web-styles$/,
        replacement: path.join(WEB_ROOT, 'src', 'styles.scss'),
      },
      // 桌面 entry 直接 import 的运行时依赖，统一指向上游那一份，保证单实例
      { find: /^react(\/.*)?$/, replacement: `${UPSTREAM_MODULES}/react$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `${UPSTREAM_MODULES}/react-dom$1` },
      { find: /^localforage$/, replacement: path.join(UPSTREAM_MODULES, 'localforage') },
    ],
  },

  build: {
    outDir: OUT_DIR,
    // 暂存目录每次都是全新的唯一路径，不需要 vite 再清空一次；
    // 关掉它可以省掉一轮几十个文件的删除（某些环境保护策略会拦这类批量删除）。
    emptyOutDir: false,
    assetsDir: 'assets',
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4096,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      // 用桌面自己的 index.html 作为入口：CSP 与"去统计脚本"都在这里，
      // 不需要事后改写上游产物。
      input: path.join(DESKTOP_DIR, 'entry', 'index.html'),
    },
  },
};
