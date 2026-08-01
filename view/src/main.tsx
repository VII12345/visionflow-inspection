import React from 'react';
import ReactDOM from 'react-dom/client';
import { storage } from './services/storage';
import './index.css';

async function bootstrap() {
  await storage.initialize();
  // 产品/线体配置以远端为准：启动时从后端加载（首次自动把本地数据迁到后端）
  await storage.syncCatalogFromServer();
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();

