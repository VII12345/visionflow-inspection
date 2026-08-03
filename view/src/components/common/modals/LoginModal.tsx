import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { api } from '../../../services/api';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { ModalTextField } from './modalFields';

export const LoginModal: React.FC = () => {
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const setAuthUser = useAppStore(s => s.setAuthUser);
  const setModal = useAppStore(s => s.setModal);

  const handleLogin = async () => {
    setError('');
    if (!name || !pwd) { setError('请输入用户名和密码'); return; }
    try {
      const result = await api.login(name, pwd);
      if (!result.success) {
        setError(result.message || '用户名或密码错误');
        return;
      }
      if (!result.user) {
        setError('登录失败: 未返回用户信息');
        return;
      }
      setAuthUser(result.user, result.token || null);
      setName(''); setPwd('');
      setModal('login', false);
    } catch (e) {
      setError('登录失败: ' + ((e as Error).message || '无法连接后端'));
    }
  };

  return (
    <Modal open={true} onClose={() => setModal('login', false)} title="用户登录"
      footer={<>
        <Button variant="primary" onClick={handleLogin}>登录</Button>
        <Button variant="secondary" onClick={() => setModal('login', false)}>取消</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <ModalTextField
          label="用户名"
          hint="填写登录账户名称，登录时由后端校验账户列表。"
          placeholder="输入用户名"
          value={name}
          onChange={setName}
          onEnter={handleLogin}
        />
        <ModalTextField
          label="密码"
          hint="填写当前账户密码。密码不会显示在界面上。"
          type="password"
          placeholder="输入密码"
          value={pwd}
          onChange={setPwd}
          onEnter={handleLogin}
        />
        {error && <p className="text-ng text-xs">{error}</p>}
      </div>
    </Modal>
  );
};
