import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/manrope/index.css';
import './styles.css';
import { App } from './App';

document.title = 'Visa Atlas · 世界签证图谱';
document.documentElement.lang = 'zh-CN';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // 前端不做远程上报；保持控制台干净，仅渲染兜底界面
  }

  render() {
    if (this.state.error) {
      return (
        <div className="va-fatal">
          <div className="va-fatal__card va-panel">
            <span className="va-eyebrow">RENDER ERROR</span>
            <h1>页面渲染遇到问题</h1>
            <p className="va-fatal__message">{this.state.error.message || '未知渲染错误。'}</p>
            <button type="button" className="va-button va-button--primary" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('缺少 #root 挂载节点');

createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
