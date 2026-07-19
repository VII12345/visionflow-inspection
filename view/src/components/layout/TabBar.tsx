import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { TabId } from '../../types';

const TABS: { id: TabId; label: string; fixed: boolean }[] = [
  { id: 'run', label: '运行', fixed: true },
  { id: 'file', label: '文件', fixed: true },
  { id: 'settings', label: '设置', fixed: true },
  { id: 'user', label: '用户', fixed: true },
];

export const TabBar: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const closeDynamicTab = useAppStore(s => s.closeDynamicTab);

  return (
    <nav className="flex items-center bg-white border-b border-gray-200 shrink-0 px-6 relative">
      <div className="flex gap-0 flex-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative inline-flex items-center px-5 py-3 text-[13px] font-medium transition-colors select-none ${
              activeTab === tab.id
                ? 'text-accent after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:bg-accent after:rounded-full'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}

        {Array.from(dynamicTabs).map(tabId => {
          const camId = tabId.replace('cam-detail-', '');
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId as TabId)}
              className={`relative inline-flex items-center gap-1.5 px-5 py-3 text-[13px] font-medium transition-colors select-none ${
                activeTab === tabId
                  ? 'text-accent after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:bg-accent after:rounded-full'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Cam {camId} 详情
              <span
                className="ml-1 text-sm text-text-tertiary hover:text-ng px-1 transition-colors"
                onClick={(e) => { e.stopPropagation(); closeDynamicTab(tabId); }}
              >&times;</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
