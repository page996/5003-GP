import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/manrope/index.css';
import './styles.css';
import { App } from './App';
import { LanguageProvider } from './i18n.tsx';

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
      const english =
        typeof window !== 'undefined' && window.localStorage.getItem('visaatlas-lang') === 'en';
      return (
        <div className="va-boot">
          <div className="va-boot__card">
            <span className="va-boot__eyebrow">RENDER ERROR</span>
            <h1>{english ? 'The page failed to render' : '页面渲染遇到问题'}</h1>
            <p>{this.state.error.message || (english ? 'Unknown rendering error.' : '未知渲染错误。')}</p>
            <button type="button" className="va-text-button" onClick={() => window.location.reload()}>
              {english ? 'Reload page' : '刷新页面'}
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
    <LanguageProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </LanguageProvider>
  </React.StrictMode>,
);
