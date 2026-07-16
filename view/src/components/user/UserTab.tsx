import React, { useState, useEffect } from 'react';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import type { User } from '../../types';

const levelLabels: Record<string, string> = { admin: '管理员', tech: '技术员', operator: '操作员' };

export const UserTab: React.FC = () => {
  const currentUser = useAppStore(s => s.user);
  const showMessage = useAppStore(s => s.showMessage);
  const setModal = useAppStore(s => s.setModal);
  const [users, setUsers] = useState<User[]>(storage.getUsers());
  const [newName, setNewName] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [newLevel, setNewLevel] = useState<'admin' | 'tech' | 'operator'>('operator');

  const refreshUsers = () => setUsers([...storage.getUsers()]);

  // 自动刷新用户列表（每10秒）
  useEffect(() => {
    const interval = setInterval(refreshUsers, 10000);
    return () => clearInterval(interval);
  }, []);

  const checkAdmin = (): boolean => {
    if (!currentUser) { setModal('login', true); return false; }
    if (currentUser.level !== 'admin') { showMessage('需要管理员权限才能管理账户'); return false; }
    return true;
  };

  const saveUser = () => {
    if (!checkAdmin()) return;
    if (!newName) { showMessage('请输入用户名'); return; }
    if (!newPwd || newPwd.length < 3) { showMessage('密码至少3位'); return; }
    if (newPwd !== newPwd2) { showMessage('两次密码不一致'); return; }

    const all = storage.getUsers();
    if (all.find(u => u.name === newName)) { showMessage('用户名已存在'); return; }

    const maxId = all.reduce((max, u) => Math.max(max, u.id), 0);
    all.push({ id: maxId + 1, name: newName, password: newPwd, level: newLevel });
    storage.saveUsers(all);
    refreshUsers();
    setNewName(''); setNewPwd(''); setNewPwd2(''); setNewLevel('operator');
    showMessage(`账户 ${newName} 创建成功`);
  };

  const deleteUser = async () => {
    if (!checkAdmin()) return;
    if (!newName) { showMessage('请输入要删除的用户名'); return; }
    if (currentUser?.name === newName) { showMessage('不能删除当前登录账户'); return; }

    const all = storage.getUsers();
    const idx = all.findIndex(u => u.name === newName);
    if (idx === -1) { showMessage('用户不存在'); return; }

    if (!window.confirm(`确认删除用户「${newName}」？`)) return;
    all.splice(idx, 1);
    storage.saveUsers(all);
    refreshUsers();
    setNewName('');
    showMessage(`用户 ${newName} 已删除`);
  };

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Create/Delete */}
      <div className="w-[380px] shrink-0 flex flex-col gap-5">
        <div className="bg-[#171d2b] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">新建账户</h3>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">名称</label>
              <input
                type="text" placeholder="输入用户名" value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full bg-[#111620] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">密码设置</label>
              <input
                type="password" placeholder="输入密码" value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                className="w-full bg-[#111620] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">密码确认</label>
              <input
                type="password" placeholder="再次输入密码" value={newPwd2}
                onChange={e => setNewPwd2(e.target.value)}
                className="w-full bg-[#111620] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">用户级别</label>
              <select
                value={newLevel}
                onChange={e => setNewLevel(e.target.value as 'admin' | 'tech' | 'operator')}
                className="w-full bg-[#111620] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[13px] text-white outline-none focus:border-[#5b6ef5] focus:shadow-[0_0_0_3px_rgba(91,110,245,0.25)] appearance-none"
              >
                <option value="admin">管理员</option>
                <option value="tech">技术员</option>
                <option value="operator">操作员</option>
              </select>
            </div>
            <div className="flex gap-3 mt-1">
              <Button variant="primary" onClick={saveUser}>保存账户</Button>
              <Button variant="danger" onClick={deleteUser}>删除账户</Button>
            </div>
          </div>
        </div>

        <div className="bg-[#171d2b] border border-white/[0.06] rounded-xl p-5 text-xs text-gray-500 leading-relaxed">
          <p className="text-gray-400 font-semibold mb-2">权限说明</p>
          <p className="mb-1"><span className="text-rose-400">管理员</span> — 最高权限，可操作所有功能</p>
          <p className="mb-1"><span className="text-blue-400">技术员</span> — 启停设备 + 相机设置</p>
          <p><span className="text-emerald-400">操作员</span> — 仅启动 / 停止设备</p>
        </div>
      </div>

      {/* Right: User List */}
      <div className="flex-1 flex flex-col">
        <h3 className="text-sm font-semibold text-white mb-3">现有账户列表</h3>
        <div className="border border-white/[0.06] rounded-xl overflow-auto flex-1 bg-[#171d2b]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-[#1e2534] sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">ID</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">用户名</th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium">用户级别</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-3 text-gray-500">{u.id}</td>
                  <td className="px-4 py-3 text-white">{u.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={u.level}>{levelLabels[u.level]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
