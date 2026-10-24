const fs = require('node:fs');
const path = require('node:path');
const { verifyWebBuild, report } = require('./check-web-build');

const source = path.resolve(__dirname, '../../dist/apps/web');
const target = path.resolve(__dirname, '../dist/apps/web');
// 暂存/备份与 target 同盘，保证 renameSync 是原子替换而不是跨盘复制
const staging = path.resolve(__dirname, '../dist/.web-staging');
const backup = path.resolve(__dirname, '../dist/.web-backup');
const force = process.argv.includes('--force');

const HOSTING_FILES = ['_redirects', '_headers', 'robots.txt', 'sitemap.xml'];

function fail(message) {
  console.error(`[sync-web] ${message}`);
  process.exit(1);
}

function cleanHostingFiles(dir) {
  for (const name of HOSTING_FILES) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

function describe(errors) {
  for (const error of errors) console.error(`[sync-web] 缺失：${error}`);
}

if (!fs.existsSync(source)) {
  // 独立克隆本仓库时没有上游产物目录，直接复用已提交的 dist/apps/web
  if (fs.existsSync(path.join(target, 'index.html'))) {
    console.log('[sync-web] 未找到上游产物，沿用现有 dist/apps/web');
    const errors = verifyWebBuild(target);
    if (errors.length > 0) {
      describe(errors);
      if (!force) {
        fail(
          '现有 dist/apps/web 不含桌面适配层，拒绝继续打包。\n' +
            '确认要用纯 Web 产物时执行 npm run sync:web -- --force。'
        );
      }
      console.warn('[sync-web] --force：继续使用缺少桌面适配层的产物');
    }
    process.exit(0);
  }
  fail(`渲染层产物不存在：${source}\n请先在 Drawnix 上游仓库根目录执行 npm run build:web`);
}

// 上游产物必须是已打桌面适配补丁的构建，否则同步会覆盖掉仓库里唯一的适配来源
if (!force) {
  const sourceErrors = verifyWebBuild(source);
  if (sourceErrors.length > 0) {
    describe(sourceErrors);
    fail(
      '拒绝同步：上游产物不含桌面适配层，直接覆盖会让安装包退化为纯 Web 版。\n' +
        '请先在上游仓库应用桌面适配补丁，或执行 npm run sync:web -- --force 明确强制覆盖。'
    );
  }
}

// 1) 先复制到暂存目录，验证通过后再替换，避免半成品或适配层缺失的产物落到 target
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.dirname(staging), { recursive: true });
fs.cpSync(source, staging, { recursive: true });
cleanHostingFiles(staging);

if (!force && !report(staging, verifyWebBuild(staging))) {
  fs.rmSync(staging, { recursive: true, force: true });
  fail('暂存产物校验失败，已保留现有 dist/apps/web');
}

// 2) 原子替换：旧产物先改名备份，替换失败则回滚
fs.rmSync(backup, { recursive: true, force: true });
const hadTarget = fs.existsSync(target);
if (hadTarget) {
  try {
    fs.renameSync(target, backup);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    fail(`备份现有产物失败，未做任何修改：${error.message}`);
  }
}

try {
  fs.renameSync(staging, target);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  if (hadTarget) {
    try {
      fs.renameSync(backup, target);
    } catch (rollbackError) {
      fail(`替换产物失败且回滚失败，请手工恢复 ${backup} -> ${target}：${rollbackError.message}`);
    }
    fail(`替换产物失败，已回滚：${error.message}`);
  }
  fail(`替换产物失败：${error.message}`);
}

fs.rmSync(backup, { recursive: true, force: true });
console.log(`[sync-web] 已同步 ${source} -> ${target}`);
