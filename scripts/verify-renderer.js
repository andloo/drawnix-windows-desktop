#!/usr/bin/env node
/**
 * 校验 dist/apps/web 是否是一份"带桌面适配层"的渲染层。
 *
 * 单独可跑，也作为 build-renderer 的构建后检查：
 *   npm run verify:renderer
 *   npm run verify:renderer -- --dir some/other/build
 */

const path = require('node:path');
const { DIST_WEB, verifyRenderer, reportVerify } = require('./upstream');

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const target = dirIndex >= 0 && args[dirIndex + 1] ? path.resolve(args[dirIndex + 1]) : DIST_WEB;

const ok = reportVerify(target, verifyRenderer(target));
process.exitCode = ok ? 0 : 1;
