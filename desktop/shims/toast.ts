/**
 * 桌面适配层自己的保存提示（保存成功 / 保存失败）。
 *
 * 配色不写死：宿主元素挂在 `.drawnix` 容器内部，直接复用上游为内置 toast 定义的
 * 主题变量 —— --toast-bg-color / --toast-border-color / --toast-text-color /
 * --toast-description-color。因此 default / colorful / soft / retro / dark / starry
 * 六套主题都能自动匹配，上游以后新增主题也会跟着变。
 *
 * 结构上复用上游的 .drawnix-toast 类名，让圆角、阴影、最小宽度跟内置 toast 一致；
 * 颜色与排版用内联样式覆盖，这样即使上游改了类名，提示仍然可读且符合主题。
 */

type ToastType = 'success' | 'error';

const CONTAINER_SELECTOR = '.drawnix';
const HOLD_MS: Record<ToastType, number> = {
  success: 2600,
  error: 5200,
};

// 失败态在主题底色上叠一层极淡的红，既保留主题观感又能一眼区分
const ERROR_ACCENT = '#e24b4a';

const THEME_BG = 'var(--toast-bg-color, var(--island-bg-color, #ffffff))';
const THEME_BORDER = 'var(--toast-border-color, var(--island-border-color, #eeeeee))';
const THEME_TEXT = 'var(--toast-text-color, var(--color-gray-90, #1e1e1e))';
const THEME_DESC = 'var(--toast-description-color, var(--color-gray-70, #5c5c5c))';

let host: HTMLDivElement | null = null;
let hideTimer: number | null = null;

/** 主题变量定义在 .drawnix 上，宿主必须挂在它内部才能继承到 */
const resolveContainer = (): HTMLElement =>
  (document.querySelector(CONTAINER_SELECTOR) as HTMLElement | null) ?? document.body;

const createHost = (): HTMLDivElement => {
  const container = resolveContainer();

  const element = document.createElement('div');
  element.className = 'drawnix-toast';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  Object.assign(element.style, {
    position: 'absolute',
    bottom: '36px',
    left: '50%',
    zIndex: '2023',
    pointerEvents: 'none',
    // 与上游 .drawnix-toast 保持一致的排版；颜色交给主题变量
    padding: '10px 16px',
    borderRadius: 'var(--border-radius-md, 8px)',
    boxShadow: 'var(--toast-shadow, var(--shadow-island, 0 0 16px #00000014))',
    border: `1px solid ${THEME_BORDER}`,
    fontSize: '14px',
    lineHeight: '1.5',
    textAlign: 'center',
    color: THEME_TEXT,
    opacity: '0',
    transform: 'translateX(-50%) translateY(6px)',
    transition: 'opacity 160ms ease, transform 160ms ease',
    wordBreak: 'break-word',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  container.appendChild(element);
  return element;
};

const ensureHost = (): HTMLDivElement => {
  const container = resolveContainer();
  if (host && host.isConnected && host.parentElement === container) return host;
  // 主题切换只改 .drawnix 的 class，元素不变；只有容器重新挂载时才需要重建
  host?.remove();
  host = createHost();
  return host;
};

const clear = () => {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!host) return;
  host.style.opacity = '0';
  host.style.transform = 'translateX(-50%) translateY(6px)';
  const element = host;
  window.setTimeout(() => {
    if (element === host) element.style.display = 'none';
  }, 200);
};

export const showToast = (type: ToastType, message: string, description?: string) => {
  const element = ensureHost();
  element.textContent = '';

  if (type === 'error') {
    // color-mix 不被支持时该声明会被丢弃，自动退回主题底色
    element.style.background = `color-mix(in srgb, ${ERROR_ACCENT} 14%, ${THEME_BG})`;
    element.style.borderColor = `color-mix(in srgb, ${ERROR_ACCENT} 45%, ${THEME_BORDER})`;
  } else {
    element.style.background = THEME_BG;
    element.style.borderColor = THEME_BORDER;
  }
  element.style.color = THEME_TEXT;

  const title = document.createElement('div');
  title.className = 'drawnix-toast__message';
  title.textContent = message;
  element.appendChild(title);

  if (description) {
    const detail = document.createElement('div');
    detail.className = 'drawnix-toast__description';
    detail.textContent = description;
    Object.assign(detail.style, {
      marginTop: '2px',
      fontSize: '12px',
      lineHeight: '1.4',
      color: THEME_DESC,
    });
    element.appendChild(detail);
  }

  element.style.display = 'block';
  // 强制回流，保证从 display:none 切换过来时过渡能生效
  void element.offsetHeight;
  element.style.opacity = '1';
  element.style.transform = 'translateX(-50%) translateY(0)';

  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(clear, HOLD_MS[type]);
};
