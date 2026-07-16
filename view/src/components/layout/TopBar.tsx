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
    <header className="flex items-center justify-between h-14 px-7 bg-[#111620] border-b border-white/[0.06] shrink-0 z-[100] relative">
      <div className="flex items-center gap-4">
        <h1 className="text-base font-bold text-white tracking-[1.5px] uppercase">视觉检测系统</h1>
        <span className={`text-xs font-semibold px-3.5 py-1 rounded-full border transition-all duration-300 ${
          isRunning
            ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
            : 'text-gray-500 border-white/[0.09] bg-[#1e2534]'
        }`}>
          ● {isRunning ? '运行中' : '停止'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {user ? (
          <>
            <span className="text-gray-400 text-[13px]">
              <span className="text-white font-semibold mr-2">{user.name}</span>
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                user.level === 'admin' ? 'bg-rose-500/15 text-rose-400' :
                user.level === 'tech' ? 'bg-blue-500/15 text-blue-400' :
                'bg-emerald-500/15 text-emerald-400'
              }`}>{roleLabels[user.level]}</span>
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
