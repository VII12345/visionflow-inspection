import React from 'react';
import ReactDOM from 'react-dom/client';
import { storage } from './services/storage';
import './index.css';

async function bootstrap() {
  await storage.initialize();
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();

