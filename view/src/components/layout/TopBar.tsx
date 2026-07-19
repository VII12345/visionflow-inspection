import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Modal';

const roleLabels: Record<string, string> = { admin: '管理员', tech: '技术员', operator: '操作员' };

export const TopBar: React.FC = () => {
  const user = useAppStore(s => s.user);
  const isRunning = useAppStore(s => s.isRunning);
  const logout = useAppStore(s => s.logout);
  const setModal = useAppStore(s => s.setModal);

  return (
    <header className="flex items-center justify-between h-14 px-8 bg-white border-b border-gray-200 shrink-0 relative">
      <div className="flex items-center gap-5">
        <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">视觉检测系统</h1>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
          isRunning ? 'text-ok' : 'text-text-tertiary'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-ok' : 'bg-gray-300'}`} />
          {isRunning ? '运行中' : '已停止'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {user ? (
          <>
            <span className="text-sm text-text-secondary">
              <span className="text-text-primary font-medium mr-2">{user.name}</span>
              <span className="text-xs text-text-tertiary">{roleLabels[user.level]}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setModal('changePwd', true)}>修改密码</Button>
            <Button variant="secondary" size="sm" onClick={logout}>登出</Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setModal('login', true)}>登录</Button>
        )}
      </div>
    </header>
  );
};
