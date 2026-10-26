/**
 * 窗口状态持久化：记住上次退出时的全屏 / 最大化 / 窗口尺寸与位置。
 *
 * 只做一件事，所以单独成文件：
 *   - 启动时读 userData/window-state.json，校验位置是否还在某块屏幕上（拔掉外接屏
 *     后不能把窗口恢复到看不见的地方）；
 *   - 运行期监听尺寸/位置/最大化/全屏变化，防抖写回。
 *
 * 状态文件放在 %APPDATA%\drawnix-desktop\ 下（app.getName() 取自 package.json 的 name），
 * 卸载默认保留（electron-builder 里
 * deleteAppDataOnUninstall: false）。
 */

import { app, BrowserWindow, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type StoredBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type WindowState = {
  isFullScreen: boolean;
  isMaximized: boolean;
  bounds: StoredBounds;
};

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const SAVE_DELAY = 400;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

const defaultState = (): WindowState => ({
  isFullScreen: false,
  isMaximized: false,
  bounds: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
});

/** 窗口至少要有一部分落在某块屏幕上，否则丢弃保存的位置、让系统居中 */
const isOnSomeDisplay = (bounds: StoredBounds) => {
  if (bounds.x === undefined || bounds.y === undefined) return false;
  if (bounds.width <= 0 || bounds.height <= 0) return false;

  const margin = 80;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x! + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x!, workArea.x);
    const overlapY =
      Math.min(bounds.y! + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y!, workArea.y);
    return overlapX >= margin && overlapY >= margin / 2;
  });
};

export const loadWindowState = (): WindowState => {
  let parsed: Partial<WindowState> = {};
  try {
    parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<WindowState>;
  } catch {
    return defaultState();
  }

  const saved = parsed.bounds;
  const bounds: StoredBounds =
    saved && isOnSomeDisplay(saved)
      ? {
          x: saved.x,
          y: saved.y,
          width: Math.max(saved.width, 800),
          height: Math.max(saved.height, 600),
        }
      : {
          // 位置不可用（首次运行 / 换了显示器），只沿用尺寸，位置交给系统
          width: Math.max(saved?.width ?? DEFAULT_WIDTH, 800),
          height: Math.max(saved?.height ?? DEFAULT_HEIGHT, 600),
        };

  return {
    isFullScreen: Boolean(parsed.isFullScreen),
    isMaximized: Boolean(parsed.isMaximized),
    bounds,
  };
};

export const trackWindowState = (win: BrowserWindow, initial: WindowState) => {
  let timer: NodeJS.Timeout | null = null;
  // 全屏/最大化时 getBounds() 返回的不是"还原尺寸"，所以自己缓存最后一次普通状态
  let normalBounds: StoredBounds = { ...initial.bounds };
  let fullScreen = initial.isFullScreen;
  let maximized = initial.isMaximized;

  const capture = () => {
    if (win.isDestroyed()) return;
    fullScreen = win.isFullScreen();
    maximized = win.isMaximized();
    if (!fullScreen && !maximized) {
      const { x, y, width, height } = win.getBounds();
      normalBounds = { x, y, width, height };
    }
  };

  const flush = () => {
    if (win.isDestroyed()) return;
    capture();
    const state: WindowState = { isFullScreen: fullScreen, isMaximized: maximized, bounds: normalBounds };
    try {
      writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.warn('[window-state] 写入失败：', error instanceof Error ? error.message : error);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, SAVE_DELAY);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('enter-full-screen', schedule);
  win.on('leave-full-screen', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    timer = null;
    flush();
  });
};
