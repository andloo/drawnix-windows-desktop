const fs = require('node:fs');
const path = require('node:path');

// 桌面适配层只存在于预构建产物中，这里用特征字符串确认它没有被未打补丁的上游构建覆盖。
// 缺少任意一项，安装包都会退化为纯 Web 版：保存变成浏览器下载、CSP 丢失。
const HTML_MARKERS = [
  { label: 'CSP meta 标签', pattern: /Content-Security-Policy/ },
  { label: '根路径 base href', pattern: /<base\s+href="\/"/ },
  { label: '入口脚本', pattern: /<script[^>]+src="\/assets\/[^"]+\.js"/ },
];

const JS_MARKERS = [
  { label: '桌面桥接 window.drawnixDesktop', pattern: /window\.drawnixDesktop/ },
  { label: '原生打开对话框 openFiles', pattern: /openFiles/ },
  { label: '原生保存 saveFileAs', pattern: /saveFileAs/ },
  { label: '打开文件事件订阅 onOpenFile', pattern: /onOpenFile/ },
  { label: '保存结果提示 toast.save.success', pattern: /toast\.save\.success/ },
];

function readAssetsScripts(dir) {
  const assetsDir = path.join(dir, 'assets');
  if (!fs.existsSync(assetsDir)) return [];
  return fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const filePath = path.join(assetsDir, name);
      return { filePath, text: fs.readFileSync(filePath, 'utf8') };
    });
}

// 返回问题列表，空数组表示校验通过
function verifyWebBuild(dir) {
  if (!fs.existsSync(dir)) return [`目录不存在：${dir}`];

  const indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) return [`缺少 index.html：${indexPath}`];

  const errors = [];
  const html = fs.readFileSync(indexPath, 'utf8');

  for (const marker of HTML_MARKERS) {
    if (!marker.pattern.test(html)) errors.push(`index.html 缺少${marker.label}`);
  }

  // index.html 引用的静态资源必须全部存在，避免同步到不完整的构建
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    const assetPath = path.join(dir, match[1].replace(/^\//, ''));
    if (!fs.existsSync(assetPath)) errors.push(`index.html 引用的资源不存在：${match[1]}`);
  }

  const scripts = readAssetsScripts(dir);
  if (scripts.length === 0) {
    errors.push('assets 目录下没有任何 js 文件');
    return errors;
  }

  const combined = scripts.map((script) => script.text).join('\n');
  for (const marker of JS_MARKERS) {
    if (!marker.pattern.test(combined)) errors.push(`js 产物缺少桌面适配标记：${marker.label}`);
  }

  return errors;
}

function report(dir, errors) {
  if (errors.length === 0) {
    console.log(`[verify-web] 校验通过：${dir}`);
    return true;
  }
  for (const error of errors) console.error(`[verify-web] 缺失：${error}`);
  console.error(`[verify-web] 校验失败：${dir}`);
  return false;
}

if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '../dist/apps/web');
  process.exitCode = report(dir, verifyWebBuild(dir)) ? 0 : 1;
}

module.exports = { verifyWebBuild, report };
