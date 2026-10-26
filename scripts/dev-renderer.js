#!/usr/bin/env node
/**
 * 启动桌面版渲染层的开发服务器（带桌面适配层，支持 HMR）。
 *
 * 与 `npm run electron:dev` 配合使用：
 *   终端 1：npm run dev:renderer          # http://localhost:7201
 *   终端 2：DRAWNIX_DEV_URL=http://localhost:7201 npm run electron:dev
 *
 * 上游自带的 `npm start`（7200 端口）跑的是纯 Web 版本，不含桌面适配层，
 * 只能用来调画布功能本身。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { REPO_ROOT, resolveUpstream, fail } = require('./upstream');

const upstream = resolveUpstream();
const viteBin = path.join(upstream, 'node_modules', 'vite', 'bin', 'vite.js');
const config = path.join(REPO_ROOT, 'desktop', 'vite.desktop.config.mjs');

if (!fs.existsSync(viteBin)) {
  fail(`上游缺少依赖，请先在 ${upstream} 执行 npm ci`);
}

console.log(`[dev-renderer] 上游：${upstream}`);
console.log('[dev-renderer] 桌面渲染层开发服务器：http://localhost:7201');
console.log('[dev-renderer] 另开终端执行：DRAWNIX_DEV_URL=http://localhost:7201 npm run electron:dev\n');

const child = spawn(process.execPath, [viteBin, '--config', config], {
  cwd: upstream,
  stdio: 'inherit',
  env: {
    ...process.env,
    DRAWNIX_UPSTREAM: upstream,
    DRAWNIX_OUT_DIR: path.join(REPO_ROOT, 'dist', 'apps', 'web'),
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
