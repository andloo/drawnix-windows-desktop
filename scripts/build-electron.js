#!/usr/bin/env node
/**
 * 编译 Electron 主进程与 preload。
 *
 * 相比直接写 esbuild 命令行，这里多做一件事：把 upstream.lock.json 里的上游版本
 * 以编译期常量注入，让"关于"对话框能显示"这个安装包基于哪个上游 commit"。
 * 常量在打包后不需要额外文件，也不会因为用户机器上缺文件而报错。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO_ROOT, readLock, fail } = require('./upstream');

const lock = readLock();
const upstream = lock.upstream || {};
const upstreamVersion = upstream.describe || 'unknown';
const upstreamCommit = upstream.commit ? upstream.commit.slice(0, 7) : 'unknown';

const esbuild = path.join(REPO_ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
if (!fs.existsSync(esbuild)) {
  fail('未找到 esbuild，请先在桌面仓库执行 npm install');
}

const args = [
  esbuild,
  'electron/main.ts',
  'electron/preload.ts',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--external:electron',
  '--outdir=electron/dist',
  '--sourcemap',
  `--define:__UPSTREAM_VERSION__=${JSON.stringify(upstreamVersion)}`,
  `--define:__UPSTREAM_COMMIT__=${JSON.stringify(upstreamCommit)}`,
];

console.log(`[build-electron] 上游版本 ${upstreamVersion}（${upstreamCommit}）`);

const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' });
if (result.status !== 0) {
  fail(`esbuild 失败，退出码 ${result.status}`);
}
