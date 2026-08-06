import React, { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { canAccessTab } from '../../services/permissions';
import { RunTab } from '../run/RunTab';
import { FileTab } from '../file/FileTab';
import { SettingsTab } from '../settings/SettingsTab';
import { UserTab } from '../user/UserTab';
import { PlcTab } from '../settings/PlcTab';
import { ModelSettingsTab } from '../settings/ModelSettingsTab';
import { HelpTab } from '../help/HelpTab';
import { TestTab } from '../test/TestTab';
import { CameraDetailTab } from '../camera/CameraDetailTab';
import { LogTab } from '../logs/LogTab';

/** 主内容区按激活页签渲染对应页面。 */
export const TabRouter: React.FC = () => {
  const activeTab = useAppStore(s => s.activeTab);
  const user = useAppStore(s => s.user);

  useEffect(() => {
    if (!canAccessTab(user?.level || null, activeTab)) useAppStore.getState().setActiveTab('run');
  }, [activeTab, user?.level]);

  if (activeTab === 'run') return <RunTab />;
  if (activeTab === 'file') return <FileTab />;
  if (activeTab === 'settings') return <SettingsTab />;
  if (activeTab === 'user') return <UserTab />;
  if (activeTab === 'plc') return <PlcTab />;
  if (activeTab === 'models') return <ModelSettingsTab />;
  if (activeTab === 'help') return <HelpTab />;
  if (activeTab === 'test') return <TestTab />;
  if (activeTab === 'logs') return <LogTab />;
  if (activeTab.startsWith('cam-detail-')) {
    const camId = parseInt(activeTab.replace('cam-detail-', ''));
    return <CameraDetailTab camId={camId} />;
  }
  return <RunTab />;
};
