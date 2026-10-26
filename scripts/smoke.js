#!/usr/bin/env node
/**
 * 启动冒烟：用 Playwright 驱动真实的 Electron 应用，验证"能用"而不只是"字在产物里"。
 *
 * 依赖：桌面仓库装了 electron；上游仓库装了 playwright（devDependencies 自带）。
 * 任一缺失时脚本以退出码 0 跳过，不阻塞打包流程 —— 但 CI 里应当视为必须执行。
 *
 *   npm run smoke
 *   npm run smoke -- --keep-open    # 断言完不退出，便于人工看一眼
 *   npm run smoke -- --packaged     # 冒烟 release/win-unpacked 里的打包产物
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { REPO_ROOT, resolveUpstream } = require('./upstream');

const keepOpen = process.argv.includes('--keep-open');
const packaged = process.argv.includes('--packaged');

const loadPlaywright = () => {
  const upstream = resolveUpstream();
  const candidates = [
    path.join(upstream, 'node_modules', 'playwright'),
    path.join(REPO_ROOT, 'node_modules', 'playwright'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      try {
        return require(dir);
      } catch {
        /* 继续找下一个 */
      }
    }
  }
  return null;
};

const electronBinary = () => {
  try {
    // 在 Node 进程里 require('electron') 返回可执行文件路径
    const resolved = require(path.join(REPO_ROOT, 'node_modules', 'electron'));
    return typeof resolved === 'string' && fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const playwright = loadPlaywright();
  if (!playwright || !playwright._electron) {
    console.log('[smoke] 未找到 playwright，跳过（在上游仓库执行 npm ci 即可获得）');
    process.exit(0);
  }
  if (!electronBinary()) {
    console.log('[smoke] 未安装 electron，跳过（在桌面仓库执行 npm i 即可）');
    process.exit(0);
  }

  const rendererIndex = path.join(REPO_ROOT, 'dist', 'apps', 'web', 'index.html');
  if (!fs.existsSync(rendererIndex)) {
    console.error('[smoke] 渲染层产物不存在，请先 npm run build:renderer');
    process.exit(1);
  }

  // --packaged：直接冒烟 release/win-unpacked 里的成品，验证 asar 内的资源与协议
  // DRAWNIX_PACKAGED_DIR 可以指向别的打包输出目录（例如按版本号分目录时）
  const packagedDir = process.env.DRAWNIX_PACKAGED_DIR
    ? path.resolve(process.env.DRAWNIX_PACKAGED_DIR)
    : path.join(REPO_ROOT, 'release', 'win-unpacked');
  const packagedExe = path.join(packagedDir, 'Drawnix.exe');
  if (packaged && !fs.existsSync(packagedExe)) {
    console.error(`[smoke] 未找到打包产物 ${packagedExe}，请先 npm run dist:win`);
    process.exit(1);
  }

  console.log(`[smoke] 启动 Electron …${packaged ? '（打包产物）' : '（源码模式）'}`);
  // 从 agent/IDE 里启动时环境可能带着 ELECTRON_RUN_AS_NODE=1，
  // 那会让 Electron 退化成纯 Node，主进程里 require('electron').app 为 undefined。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // 强制加载内置渲染层，验证"安装版行为"而不是 dev server
  env.DRAWNIX_USE_BUNDLE = '1';
  delete env.DRAWNIX_DEV_URL;
  // 用独立的用户数据目录，避免测试改动真实用户的画板数据与窗口状态
  env.DRAWNIX_USER_DATA = path.join(os.tmpdir(), 'drawnix-smoke-profile');

  // 用一个临时图稿文件启动，顺带验证"打开文件 → Ctrl+S 直接覆盖"这条链路：
  // 如果 fileHandle 没被写进 appState，Ctrl+S 会退化成另存为（弹原生对话框），
  // 断言会拿不到"已保存"提示从而失败。
  const fixture = path.join(os.tmpdir(), `drawnix-smoke-${Date.now()}.drawnix`);
  fs.writeFileSync(
    fixture,
    JSON.stringify({ type: 'drawnix', version: 1, source: 'web', elements: [], viewport: { zoom: 1 } }, null, 2)
  );
  const fixtureMtime = fs.statSync(fixture).mtimeMs;

  const app = await playwright._electron.launch({
    // playwright 会从自己的 node_modules 里找 electron，而桌面仓库的 electron
    // 并不在上游依赖树里，必须显式指定
    executablePath: packaged ? packagedExe : electronBinary(),
    args: packaged ? [fixture] : [REPO_ROOT, fixture],
    cwd: REPO_ROOT,
    env,
    timeout: 60_000,
  });

  const externalRequests = [];
  try {
    const window = await app.firstWindow({ timeout: 60_000 });

    window.on('request', (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });

    const cspErrors = [];
    window.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
        cspErrors.push(message.text());
      }
    });

    await window.waitForSelector('.drawnix', { timeout: 60_000 });
    record('画布容器渲染', true);

    const bridge = await window.evaluate(() => {
      const value = window.drawnixDesktop;
      return {
        exists: Boolean(value),
        methods: value
          ? ['openFiles', 'writeFile', 'saveFileAs', 'ready', 'onOpenFile'].filter(
              (name) => typeof value[name] === 'function'
            )
          : [],
      };
    });
    record('桌面桥接注入', bridge.exists && bridge.methods.length === 5, bridge.methods.join(','));

    const version = await window.evaluate(() => window.drawnixDesktop?.getVersion?.());
    record('版本号读取', typeof version === 'string' && version.length > 0, String(version));

    // 原生写入链路：preload → IPC → 主进程 fs → 磁盘，再读回来比对
    const probeFile = path.join(os.tmpdir(), `drawnix-smoke-${Date.now()}.bin`);
    const payload = [0x44, 0x52, 0x41, 0x57];
    const written = await window.evaluate(
      ([filePath, bytes]) => window.drawnixDesktop.writeFile(filePath, new Uint8Array(bytes)),
      [probeFile, payload]
    );
    const onDisk = fs.existsSync(probeFile) ? Array.from(fs.readFileSync(probeFile)) : [];
    fs.rmSync(probeFile, { force: true });
    record(
      '原生写入落盘',
      written === probeFile && onDisk.join(',') === payload.join(','),
      path.basename(probeFile)
    );

    // 工具栏说明上游 React 树已经完整挂载（不只是渲染了一个空容器）
    const toolbar = await window.evaluate(() => ({
      app: Boolean(document.querySelector('.app-toolbar')),
      creation: Boolean(document.querySelector('.creation-toolbar, .draw-toolbar')),
      canvas: Boolean(document.querySelector('canvas')),
    }));
    record(
      '工具栏与画布挂载',
      toolbar.app && toolbar.canvas,
      `app-toolbar=${toolbar.app} canvas=${toolbar.canvas}`
    );

    record('无 CSP 报错', cspErrors.length === 0, cspErrors[0]);
    record(
      '无外部网络请求',
      externalRequests.length === 0,
      externalRequests.slice(0, 3).join(' ')
    );

    // 打开文件后按 Ctrl+S：应当直接覆盖原文件（不弹另存为），并弹出保存提示
    await window.mouse.move(420, 420);
    await window.mouse.move(440, 440);
    await window.waitForTimeout(200);
    await window.keyboard.press('Control+s');
    await window.waitForTimeout(900);

    record('Ctrl+S 直接覆盖原文件', fs.statSync(fixture).mtimeMs !== fixtureMtime);

    const toast = await window.evaluate(() => {
      const element = document.querySelector('.drawnix-toast');
      if (!element) return null;
      const container = document.querySelector('.drawnix');
      // 用同样的主题变量算一遍期望色，验证提示确实跟着主题走而不是写死的颜色
      const probe = document.createElement('div');
      probe.style.background = 'var(--toast-bg-color, var(--island-bg-color))';
      container.appendChild(probe);
      const themed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        text: element.innerText.split('\n')[0],
        background: getComputedStyle(element).backgroundColor,
        themed,
        insideBoard: element.parentElement === container,
        theme: container.className,
      };
    });

    record('保存提示出现', Boolean(toast) && toast.text.includes('已保存'), toast && toast.text);
    record(
      '提示配色跟随主题',
      Boolean(toast) && toast.insideBoard && toast.background === toast.themed,
      toast && `${toast.theme} → ${toast.background}`
    );

    if (keepOpen) {
      console.log('[smoke] --keep-open：保持窗口 60 秒');
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  } finally {
    if (!keepOpen) await app.close();
    fs.rmSync(fixture, { force: true });
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[smoke] 执行失败：', error);
  process.exit(1);
});
