import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';

// 上游 Web 壳的全局样式（body / #root 尺寸与 overflow），随上游一起演进
import '@drawnix-desktop/web-styles';
import App from './app';

/**
 * 上游在"打开文件"流程里没有 catch 用户取消（browser-fs-access 会抛 AbortError），
 * Web 版里这条 rejection 只落在控制台。桌面端不希望原生对话框一取消就刷红，
 * 这里统一静默 AbortError，其余错误照旧抛出。
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  if (reason instanceof DOMException && reason.name === 'AbortError') {
    event.preventDefault();
  }
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root not found');
}

ReactDOM.createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
