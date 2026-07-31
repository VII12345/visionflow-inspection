import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';
import { canAccessTab } from '../../services/permissions';

const roleLabels: Record<string, string> = { admin: '管理员', tech: '技术员', operator: '操作员' };

export const TopBar: React.FC = () => {
  const user = useAppStore(s => s.user);
  const isRunning = useAppStore(s => s.isRunning);
  const logout = useAppStore(s => s.logout);
  const setModal = useAppStore(s => s.setModal);
  const setActiveTab = useAppStore(s => s.setActiveTab);

  return (
    <header className="top-bar flex items-center justify-between h-16 px-8 shrink-0 relative">
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">视界智检</h1>
          <span className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary">VisionFlow Inspection</span>
        </div>
        <span className={`live-pill ml-3 text-xs font-medium ${isRunning ? 'text-ok' : 'text-text-tertiary'}`}>
          <span className={`live-dot ${isRunning ? 'is-running' : ''}`} />
          {isRunning ? '运行中' : '已停止'}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {canAccessTab(user?.level || null, 'help') && <button onClick={() => setActiveTab('help')} className="w-8 h-8 rounded-full border border-gray-200 bg-white/80 text-text-secondary hover:text-accent hover:border-accent transition-colors text-sm font-semibold" title="打开说明书">?</button>}
        {user ? (
          <>
            <div className="hidden sm:flex items-center gap-2.5 mr-1 px-3 py-1.5 rounded-md bg-white/70 border border-gray-100">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-semibold">
                {user.name?.slice(0, 1) || 'U'}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[12px] text-text-primary font-medium">{user.name}</span>
                <span className="text-[10px] text-text-tertiary">{roleLabels[user.level]}</span>
              </span>
            </div>
            {user.level === 'admin' && <Button variant="ghost" size="sm" onClick={() => setModal('changePwd', true)}>修改密码</Button>}
            <Button variant="secondary" size="sm" onClick={logout}>登出</Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setModal('login', true)}>登录</Button>
        )}
      </div>
    </header>
  );
};
