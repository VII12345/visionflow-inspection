import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { api } from '../../../services/api';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { ModalTextField } from './modalFields';

export const ChangePwdModal: React.FC = () => {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);

  const handleChange = async () => {
    if (user?.level !== 'admin') { setError('只有管理员可以修改密码'); return; }
    setError('');
    if (!oldPwd || !newPwd || !confirmPwd) { setError('请填写所有密码字段'); return; }
    if (newPwd.length < 3) { setError('新密码至少3位'); return; }
    if (newPwd !== confirmPwd) { setError('两次新密码不一致'); return; }
    try {
      const result = await api.changePassword(oldPwd, newPwd);
      if (!result.success) { setError(result.message || '密码修改失败'); return; }
      setModal('changePwd', false);
      showMessage('密码修改成功');
    } catch (e) {
      setError('密码修改失败: ' + ((e as Error).message || '无法连接后端'));
    }
  };

  return (
    <Modal open={true} onClose={() => setModal('changePwd', false)} title="修改密码"
      footer={<>
        <Button variant="primary" onClick={handleChange}>确认修改</Button>
        <Button variant="secondary" onClick={() => setModal('changePwd', false)}>取消</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <ModalTextField label="旧密码" hint="填写当前正在使用的密码，用于确认身份。" type="password" placeholder="输入当前密码" value={oldPwd} onChange={setOldPwd} />
        <ModalTextField label="新密码" hint="设置新的登录密码，建议使用不容易被猜到的组合。" type="password" placeholder="输入新密码" value={newPwd} onChange={setNewPwd} />
        <ModalTextField label="确认新密码" hint="再次输入新密码，两次内容必须完全一致。" type="password" placeholder="再次输入新密码" value={confirmPwd} onChange={setConfirmPwd} />
        {error && <p className="text-ng text-xs">{error}</p>}
      </div>
    </Modal>
  );
};
