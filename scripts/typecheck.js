#!/usr/bin/env node
/**
 * 只对 desktop/ 适配层做类型检查。
 *
 * 为什么不直接 `tsc -p desktop/tsconfig.json`：
 * 桌面层引用上游源码，tsc 会连带检查整个上游（上游自己用 esbuild 构建、不做类型
 * 检查，因此存在一批 scss 声明与 CSS 自定义属性相关的既有报错）。这里只把落在
 * desktop/ 目录下的诊断视为失败，上游既有问题忽略。
 *
 *   npm run typecheck
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO_ROOT, resolveUpstream, fail } = require('./upstream');

const upstream = resolveUpstream();
const tsc = path.join(upstream, 'node_modules', 'typescript', 'bin', 'tsc');

const result = spawnSync(
  process.execPath,
  [tsc, '-p', path.join(REPO_ROOT, 'desktop', 'tsconfig.json'), '--noEmit', '--pretty', 'false'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
);

if (result.error) {
  fail(`无法运行 tsc：${result.error.message}`);
}

const lines = `${result.stdout || ''}${result.stderr || ''}`
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const ours = lines.filter((line) => line.startsWith('desktop/') || line.startsWith('desktop\\'));
const upstreamIssues = lines.filter((line) => line.startsWith('..'));

if (ours.length > 0) {
  for (const line of ours) console.error(`[typecheck] ${line}`);
  fail(`desktop/ 适配层存在 ${ours.length} 处类型错误`);
}

console.log('[typecheck] desktop/ 适配层类型检查通过');
if (upstreamIssues.length > 0) {
  console.log(`[typecheck] 已忽略上游既有诊断 ${upstreamIssues.length} 条`);
}
