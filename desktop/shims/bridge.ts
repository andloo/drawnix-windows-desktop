/**
 * preload 通过 contextBridge 暴露的桌面能力，渲染层唯一的原生入口。
 *
 * 渲染层（包括上游 Drawnix 代码）不直接接触 Node / Electron API，
 * 只通过 window.drawnixDesktop 这一份白名单调用原生能力。
 */

export type DesktopFilePayload = {
  path: string;
  name: string;
  type: string;
  data: Uint8Array;
};

export type DesktopOpenOptions = {
  description?: string;
  extensions?: string[];
  multiple?: boolean;
};

export type DesktopSaveAsPayload = {
  defaultPath?: string;
  description?: string;
  extension: string;
  data: Uint8Array;
};

export type DesktopOpenedFile = {
  path: string;
  content: string;
};

export type DesktopBridge = {
  platform: string;
  getVersion: () => Promise<string>;
  openFiles: (options?: DesktopOpenOptions) => Promise<DesktopFilePayload[]>;
  writeFile: (filePath: string, data: Uint8Array) => Promise<string>;
  saveFileAs: (payload: DesktopSaveAsPayload) => Promise<string | null>;
  ready: () => Promise<DesktopOpenedFile | null>;
  onOpenFile: (callback: (payload: DesktopOpenedFile) => void) => () => void;
};

declare global {
  interface Window {
    drawnixDesktop?: DesktopBridge;
  }
}

/** 浏览器里直接跑（没有 preload）时返回 null，调用方据此退化为 Web 行为。 */
export const getBridge = (): DesktopBridge | null => {
  if (typeof window === 'undefined') return null;
  return window.drawnixDesktop ?? null;
};

export const isDesktop = (): boolean => getBridge() !== null;
