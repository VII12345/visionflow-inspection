import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { TabId } from '../../types';

const TABS: { id: TabId; icon: string; label: string; fixed: boolean }[] = [
  { id: 'run', icon: '▸', label: '运行', fixed: true },
  { id: 'file', icon: '☰', label: '文件', fixed: true },
  { id: 'settings', icon: '◇', label: '设置', fixed: true },
  { id: 'user', icon: '◎', label: '用户', fixed: true },
];

export const TabBar: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const dynamicTabs = useAppStore(s => s.dynamicTabs);
  const closeDynamicTab = useAppStore(s => s.closeDynamicTab);

  return (
    <nav className="flex items-center bg-[#111620] border-b border-white/[0.06] shrink-0 px-4 z-[99] relative">
      <div className="flex gap-0.5 flex-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-5 py-3 text-[13.5px] font-medium rounded-t-lg transition-all duration-250 select-none relative
              ${activeTab === tab.id
                ? 'text-[#7b8cf8] bg-[#5b6ef5]/[0.06] after:absolute after:bottom-0 after:left-[12%] after:right-[12%] after:h-0.5 after:bg-[#5b6ef5] after:rounded-sm after:scale-x-100 after:opacity-100'
                : 'text-gray-500 hover:text-gray-400 hover:bg-white/[0.03] after:absolute after:bottom-0 after:left-[20%] after:right-[20%] after:h-0.5 after:bg-[#5b6ef5] after:rounded-sm after:scale-x-0 after:opacity-0'
              } after:transition-all after:duration-250`}
          >
            <span className="text-[15px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}

        {Array.from(dynamicTabs).map(tabId => {
          const camId = tabId.replace('cam-detail-', '');
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId as TabId)}
              className={`inline-flex items-center gap-1.5 px-5 py-3 text-[13.5px] font-medium rounded-t-lg transition-all duration-250 select-none relative
                ${activeTab === tabId
                  ? 'text-[#7b8cf8] bg-[#5b6ef5]/[0.06] after:absolute after:bottom-0 after:left-[12%] after:right-[12%] after:h-0.5 after:bg-[#5b6ef5] after:rounded-sm after:scale-x-100 after:opacity-100'
                  : 'text-gray-500 hover:text-gray-400 hover:bg-white/[0.03] after:absolute after:bottom-0 after:left-[20%] after:right-[20%] after:h-0.5 after:bg-[#5b6ef5] after:rounded-sm after:scale-x-0 after:opacity-0'
                } after:transition-all after:duration-250`}
            >
              <span className="text-[15px]">📷</span>
              Cam{camId} 详情
              <span
                className="ml-1 text-[15px] opacity-50 hover:opacity-100 hover:bg-white/[0.08] rounded px-1 transition-all"
                onClick={(e) => { e.stopPropagation(); closeDynamicTab(tabId); }}
              >&times;</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
