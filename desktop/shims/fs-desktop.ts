/**
 * 桌面版文件能力：构建时通过 Vite alias 整体替换 'browser-fs-access'。
 *
 * 为什么替换这个包就够了？
 * 上游 packages/drawnix/src/data/filesystem.ts 是渲染层访问本地文件的唯一收口，
 * 它只从这个包导入 fileOpen / fileSave / supported 三个符号。把模块换掉，
 * 打开、保存、另存为、导出图片、插入图片、快捷键保存全部自动走原生对话框，
 * 上游源码一行都不用改，也就没有"每次上游更新要重打补丁"的问题。
 *
 * 路径是怎么在"打开"和"保存"之间传递的？
 * 打开时把绝对路径挂到返回的 File 对象 handle 字段上，上游 loadFromJSON 会把它
 * 存进 appState.fileHandle；保存时上游再把该值作为第三个参数原样传回来。
 * 对上游来说它只是个不透明令牌，所以用字符串代替 FileSystemFileHandle 完全兼容。
 */

import { getBridge, type DesktopBridge } from './bridge';
import { showToast } from './toast';

type FileWithHandle = File & { handle?: string };

type OpenFileOptions = {
  description?: string;
  /** 形如 ['.drawnix', '.json']，browser-fs-access 的约定是带点 */
  extensions?: string[];
  mimeTypes?: string[];
  multiple?: boolean;
};

type SaveFileOptions = {
  /** 形如 '1729939200000.drawnix' */
  fileName: string;
  extensions?: string[];
  description?: string;
};

/** 桌面端永远支持"原生文件"，上游据此决定是否展示文件相关菜单。 */
export const supported = true;

/**
 * 最近一次打开/保存的图稿路径。
 *
 * 作用只有一个：当上游没有把路径带下来（例如双击 .drawnix 打开、路径由主进程
 * 推送）时，让"另存为"对话框至少落在同一个目录、同一个文件名上，用户回车即可
 * 覆盖，而不是从"下载"目录里重新找一遍。
 */
let currentPath: string | null = null;

export const getCurrentPath = () => currentPath;

const DRAWNIX_EXTENSIONS = ['drawnix', 'json'];

const isZh = () => {
  const lang = document.documentElement.lang || navigator.language || 'zh';
  return lang.toLowerCase().startsWith('zh');
};

const text = (zh: string, en: string) => (isZh() ? zh : en);

const abortError = () => new DOMException('The user aborted a request.', 'AbortError');

const isAbort = (error: unknown) =>
  error instanceof DOMException ? error.name === 'AbortError' : false;

const stripDot = (extension: string) => extension.replace(/^\./, '');

const extensionOf = (options: SaveFileOptions) => {
  const fromName = options.fileName.includes('.')
    ? options.fileName.slice(options.fileName.lastIndexOf('.') + 1)
    : '';
  if (fromName) return fromName;
  const fromList = options.extensions?.[0];
  return fromList ? stripDot(fromList) : 'bin';
};

const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/EBUSY|EPERM|EACCES|resource busy|locked/i.test(message)) {
    return text(
      '文件被占用或没有写入权限，请关闭占用该文件的程序后重试',
      'The file is in use or write-protected. Close the app using it and try again.'
    );
  }
  return message;
};

const reportSaved = (filePath: string) => {
  showToast('success', text('已保存', 'Saved'), filePath);
};

const reportSaveFailed = (error: unknown) => {
  showToast('error', text('保存失败', 'Save failed'), describeError(error));
};

const isDrawnixSave = (options: SaveFileOptions) =>
  DRAWNIX_EXTENSIONS.includes(extensionOf(options).toLowerCase());

export const fileOpen = async (
  options: OpenFileOptions = {}
): Promise<File | File[]> => {
  const bridge: DesktopBridge | null = getBridge();
  if (!bridge) {
    throw new Error('desktop bridge unavailable');
  }

  const files = await bridge.openFiles({
    description: options.description,
    extensions: options.extensions?.map(stripDot),
    multiple: options.multiple ?? false,
  });

  // 与 browser-fs-access 行为对齐：用户取消时抛 AbortError，由调用方忽略
  if (files.length === 0) {
    throw abortError();
  }

  const mapped: FileWithHandle[] = files.map((item) => {
    // Uint8Array 来自 IPC（structured clone），TS 6 的 BlobPart 只接受 ArrayBuffer 视图
    const file: FileWithHandle = new File([item.data as unknown as BlobPart], item.name, {
      type: item.type,
    });
    file.handle = item.path;
    return file;
  });

  // 只有图稿文件才更新"当前路径"，插入图片（addImage）不能覆盖它
  const opened = options.multiple ? null : mapped[0];
  if (opened && DRAWNIX_EXTENSIONS.some((ext) => opened.name.toLowerCase().endsWith(`.${ext}`))) {
    currentPath = opened.handle ?? null;
  }

  return options.multiple ? mapped : mapped[0];
};

export const fileSave = async (
  blobOrPromise: Blob | Promise<Blob>,
  options: SaveFileOptions,
  existingHandle?: string | null
): Promise<string> => {
  const bridge: DesktopBridge | null = getBridge();
  if (!bridge) {
    throw new Error('desktop bridge unavailable');
  }

  const blob = await blobOrPromise;
  const data = new Uint8Array(await blob.arrayBuffer());

  try {
    // 已有路径：直接覆盖，不弹框（Ctrl+S / 菜单"保存到当前文件"）
    if (typeof existingHandle === 'string' && existingHandle.length > 0) {
      await bridge.writeFile(existingHandle, data);
      currentPath = existingHandle;
      reportSaved(existingHandle);
      return existingHandle;
    }

    // 没有路径：弹原生另存为（首次保存 / 另存为 / 导出图片）
    const saved = await bridge.saveFileAs({
      // 图稿另存为时优先落到当前文件，避免用户重新找目录
      defaultPath: isDrawnixSave(options) && currentPath ? currentPath : options.fileName,
      description: options.description,
      extension: extensionOf(options),
      data,
    });

    if (!saved) {
      throw abortError();
    }

    if (isDrawnixSave(options)) {
      currentPath = saved;
    }
    reportSaved(saved);
    return saved;
  } catch (error) {
    if (!isAbort(error)) {
      reportSaveFailed(error);
    }
    throw error;
  }
};

/**
 * browser-fs-access 的其余导出。上游目前没有使用，但保留同签名实现，
 * 这样即使将来上游新增 download / downloadBlob 调用也不会构建失败。
 */
export const download = async (blobOrResponse: Blob | Response, fileName?: string) => {
  const blob = blobOrResponse instanceof Response ? await blobOrResponse.blob() : blobOrResponse;
  const name = fileName || (blobOrResponse as Response).headers?.get('content-type') || 'download';
  await fileSave(blob, { fileName: name, description: 'Drawnix' });
};

export const downloadBlob = (blob: Blob, fileName: string) =>
  fileSave(blob, { fileName, description: 'Drawnix' });

export const directoryOpen = async (): Promise<never> => {
  throw new Error('directoryOpen is not supported on desktop');
};
