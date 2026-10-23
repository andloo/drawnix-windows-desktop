const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../dist/apps/web');
const target = path.resolve(__dirname, '../dist/apps/web');

if (!fs.existsSync(source)) {
  // 独立克隆本仓库时没有上游产物目录，直接复用已提交的 dist/apps/web
  if (fs.existsSync(path.join(target, 'index.html'))) {
    console.log('[sync-web] 未找到上游产物，沿用现有 dist/apps/web');
    process.exit(0);
  }
  console.error(`[sync-web] 渲染层产物不存在：${source}`);
  console.error('[sync-web] 请先在 Drawnix 上游仓库根目录执行 npm run build:web');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

// 托管平台专用文件在桌面端无意义
for (const name of ['_redirects', '_headers', 'robots.txt', 'sitemap.xml']) {
  fs.rmSync(path.join(target, name), { force: true });
}

console.log(`[sync-web] 已同步 ${source} -> ${target}`);
