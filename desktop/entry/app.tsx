import { useCallback, useEffect, useRef, useState } from 'react';
import { Drawnix, DrawnixToolState } from '@drawnix/drawnix';
import { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import localforage from 'localforage';
import { getBridge, type DesktopOpenedFile } from '../shims/bridge';

/**
 * 桌面版应用壳。
 *
 * 这份文件 fork 自上游 apps/web/src/app/app.tsx（约 115 行），只额外承担三件事：
 *   1. 挂载完成后与主进程握手（bridge.ready()），取走启动参数里待打开的文件；
 *   2. 订阅主进程推送的"打开文件"事件（双击 .drawnix / 单实例二次启动）；
 *   3. 打开文件后把路径写进画布的 appState.fileHandle，让 Ctrl+S 直接覆盖原文件。
 *
 * 上游 app.tsx 的职责（localforage 自动保存、语言与偏好持久化）原样保留，
 * 因此上游如果调整这块逻辑，直接对照 diff 合并即可 —— 它本来就不属于"补丁"。
 */

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type Language = 'zh' | 'en' | 'ru' | 'ar' | 'vi';

type MainBoardPreference = {
  language: Language;
  copyTransparent: boolean;
  exportTransparent: boolean;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const MAIN_BOARD_TOOL_STATE_KEY = 'main_board_tool_state';
const MAIN_BOARD_PREFERENCE_KEY = 'main_board_preference';

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

/**
 * 主进程只会把"启动时要打开的文件"交给渲染层一次（取走即清空）。
 * React StrictMode 在开发模式下会把 effect 跑两遍，这里缓存第一次的结果，
 * 避免第二次握手拿到 null 而回落到自动保存内容。
 * undefined = 还没问过；null = 问过了，没有待打开文件。
 */
let pendingFileCache: DesktopOpenedFile | null | undefined;

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [initialToolState, setInitialToolState] = useState<Partial<DrawnixToolState>>();
  const [preference, setPreference] = useState<MainBoardPreference>({
    language: 'zh',
    copyTransparent: false,
    exportTransparent: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [tutorial, setTutorial] = useState(false);

  // 当前文件路径（桌面端独有）
  const [filePath, setFilePath] = useState<string | null>(null);
  // 每次打开新文件就换 key，强制画布重新挂载并载入新内容
  const [boardKey, setBoardKey] = useState(0);
  // afterInit 拿到的画布实例，用于补写 appState.fileHandle
  const boardRef = useRef<unknown>(null);

  const updatePreference = (partialPreference: Partial<MainBoardPreference>) => {
    setPreference((currentPreference) => {
      const nextPreference = { ...currentPreference, ...partialPreference };
      localforage.setItem(MAIN_BOARD_PREFERENCE_KEY, nextPreference);
      return nextPreference;
    });
  };

  const applyOpenedFile = useCallback((payload: DesktopOpenedFile) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.content);
    } catch {
      return;
    }
    const data = parsed as { type?: string; elements?: PlaitElement[]; viewport?: Viewport; theme?: PlaitTheme };
    if (data?.type !== 'drawnix' || !Array.isArray(data.elements)) {
      return;
    }

    const next: AppValue = {
      children: data.elements,
      viewport: data.viewport,
      theme: data.theme,
    };
    setFilePath(payload.path);    setValue(next);
    setTutorial(false);
    setBoardKey((key) => key + 1);
    setLoaded(true);
    localforage.setItem(MAIN_BOARD_CONTENT_KEY, next);
  }, []);

  // 首次挂载：先问主进程有没有启动时要打开的文件，再回落到本地自动保存
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      const bridge = getBridge();
      if (pendingFileCache === undefined) {
        pendingFileCache = bridge ? await bridge.ready() : null;
      }
      const pending = pendingFileCache;

      const [storedData, storedToolState, storedPreference] = await Promise.all([
        localforage.getItem(MAIN_BOARD_CONTENT_KEY),
        localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
        localforage.getItem(MAIN_BOARD_PREFERENCE_KEY),
      ]);
      if (cancelled) return;

      if (storedToolState) {
        setInitialToolState(storedToolState as Partial<DrawnixToolState>);
      }
      if (storedPreference) {
        setPreference(storedPreference as MainBoardPreference);
      }

      if (pending) {
        // 命令行/文件关联打开的文件优先于上次的自动保存内容
        applyOpenedFile(pending);
        return;
      }

      if (storedData) {
        const appValue = storedData as AppValue;
        setValue(appValue);
        if (appValue.children && appValue.children.length === 0) {
          setTutorial(true);
        }
      } else {
        setTutorial(true);
      }
      setLoaded(true);
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [applyOpenedFile]);

  // 运行期打开文件（双击 .drawnix / 单实例二次启动）
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onOpenFile(applyOpenedFile);
  }, [applyOpenedFile]);

  /**
   * 把"当前文件路径"写进画布的 appState.fileHandle，让 Ctrl+S 直接覆盖原文件。
   *
   * 时序：双击 .drawnix 打开时，内容由主进程推送，上游没有机会像它自己的"打开"
   * 菜单那样写入 fileHandle。而 afterInit 触发时上游还没把 appState 挂到 board
   * 上（要等 board 进入 React 状态后的下一次渲染才赋值），所以这里延后重试，
   * 最多 1 秒。写的是上游 React 状态里的同一个对象引用，快捷键插件立即可见。
   *
   * 即使这段没生效，也只会退化成"Ctrl+S 弹一次另存为"，而 fs-desktop 会把
   * 对话框默认路径指到当前文件，不会丢数据。
   */
  useEffect(() => {
    if (!filePath) return;
    let attempts = 0;
    let timer = 0;
    const apply = () => {
      const board = boardRef.current as { appState?: { fileHandle?: string | null } } | null;
      if (board?.appState) {
        board.appState.fileHandle = filePath;
        return;
      }
      if (attempts++ < 20) {
        timer = window.setTimeout(apply, 50);
      }
    };
    timer = window.setTimeout(apply, 0);
    return () => window.clearTimeout(timer);
  }, [filePath, boardKey]);

  if (!loaded) {
    return null;
  }

  return (
    <Drawnix
      key={boardKey}
      value={value.children}
      viewport={value.viewport}
      theme={value.theme}
      initialToolState={initialToolState}
      initialLanguage={preference.language}
      initialPreference={{
        copyTransparent: preference.copyTransparent,
        exportTransparent: preference.exportTransparent,
      }}
      onLanguageChange={(language) => {
        updatePreference({ language });
      }}
      onPreferenceChange={({ copyTransparent, exportTransparent }) => {
        updatePreference({ copyTransparent, exportTransparent });
      }}
      onChange={(value) => {
        const newValue = value as AppValue;
        localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
        setValue(newValue);
        if (newValue.children && newValue.children.length > 0) {
          setTutorial(false);
        }
      }}
      onToolStateChange={(toolState) => {
        localforage.setItem(MAIN_BOARD_TOOL_STATE_KEY, toolState);
      }}
      tutorial={tutorial}
      afterInit={(board) => {
        boardRef.current = board;
      }}
    ></Drawnix>
  );
}

export default App;
