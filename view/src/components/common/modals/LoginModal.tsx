import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { Button, Modal } from '../Modal';
import { ModalTextField } from './modalFields';

export const LoginModal: React.FC = () => {
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const login = useAppStore(s => s.login);
  const setModal = useAppStore(s => s.setModal);

  const handleLogin = () => {
    setError('');
    if (!name || !pwd) { setError('请输入用户名和密码'); return; }
    if (!login(name, pwd)) {
      setError('用户名或密码错误');
      return;
    }
    setName(''); setPwd('');
    setModal('login', false);
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
          hint="填写登录账户名称，登录时需要与账户列表中的名称完全一致。"
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
