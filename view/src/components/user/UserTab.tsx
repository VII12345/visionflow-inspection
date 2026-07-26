import React, { useState, useEffect } from 'react';
import { storage } from '../../services/storage';
import { useAppStore } from '../../store/useAppStore';
import { Button, Badge } from '../common/Modal';
import { FieldHint } from '../common/FieldHint';
import type { User } from '../../types';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';
const labelClass = 'text-xs text-text-secondary mb-1.5 block';
const thClass = 'px-4 py-2.5 text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide';

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
  const [rememberLogin, setRememberLogin] = useState(storage.getRememberLogin());

  const refreshUsers = () => setUsers([...storage.getUsers()]);
  const saveRememberLogin = (checked: boolean) => {
    if (!checkAdmin()) return;
    storage.setRememberLogin(checked);
    setRememberLogin(checked);
    if (!checked) storage.setCurrentUser(null);
    showMessage(checked ? '下次打开系统将自动保持当前登录账户' : '已关闭保持登录，下次打开系统需要重新登录');
  };

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

  if (currentUser?.level !== 'admin') {
    return <div className="h-full flex items-center justify-center text-sm text-text-tertiary">用户管理仅限管理员使用。</div>;
  }

  return (
    <div className="flex gap-6 h-full overflow-auto">
      {/* Left: Create/Delete */}
      <div className="w-[380px] shrink-0 flex flex-col gap-5">
        <div className="bg-white rounded-lg shadow-card border border-gray-100 p-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-4">新建账户</h3>
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}><FieldHint text="填写新账户的登录名称，不能与已有账户重复。">名称</FieldHint></label>
              <input
                type="text" placeholder="输入用户名" value={newName}
                onChange={e => setNewName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}><FieldHint text="填写新账户的初始密码，建议不要使用过于简单的内容。">密码设置</FieldHint></label>
              <input
                type="password" placeholder="输入密码" value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}><FieldHint text="再次输入初始密码，确认没有输入错误。">密码确认</FieldHint></label>
              <input
                type="password" placeholder="再次输入密码" value={newPwd2}
                onChange={e => setNewPwd2(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}><FieldHint text="管理员拥有全部权限；技术员可以启停设备并修改用户管理之外的设置；操作员只能启停设备。">用户级别</FieldHint></label>
              <select
                value={newLevel}
                onChange={e => setNewLevel(e.target.value as 'admin' | 'tech' | 'operator')}
                className={`${inputClass} appearance-none`}
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

        <div className="bg-gray-50 rounded-lg border border-gray-100 p-5 text-xs text-text-secondary leading-relaxed">
          <p className="text-text-primary font-medium mb-2 text-[13px]">权限说明</p>
          <p className="mb-1"><span className="font-medium text-text-primary">管理员</span> — 最高权限，可操作所有功能</p>
          <p className="mb-1"><span className="font-medium text-text-primary">技术员</span> — 启停设备 + 用户管理之外的各类设置</p>
          <p className="mb-2"><span className="font-medium text-text-primary">操作员</span> — 仅启动 / 停止设备</p>
          <label className="flex items-center gap-2 pt-2 border-t border-gray-200 cursor-pointer"><input type="checkbox" checked={rememberLogin} onChange={e => saveRememberLogin(e.target.checked)} className="w-4 h-4 accent-accent rounded" /><span className="font-medium text-text-primary">保持登录</span><span className="text-text-tertiary">（下次打开自动登录当前账户）</span></label>
        </div>
      </div>

      {/* Right: User List */}
      <div className="flex-1 flex flex-col">
        <h3 className="text-[15px] font-semibold text-text-primary mb-4">现有账户列表</h3>
        <div className="bg-white rounded-lg shadow-card border border-gray-100 overflow-auto flex-1">
          <table className="w-full text-[13px] border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className={thClass}>ID</th>
                <th className={thClass}>用户名</th>
                <th className={thClass}>角色</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-text-tertiary">{u.id}</td>
                  <td className="px-4 py-3 font-medium text-text-primary">{u.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={u.level as 'admin' | 'tech' | 'operator'}>{levelLabels[u.level]}</Badge>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-text-tertiary text-xs">暂无可管理账户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
