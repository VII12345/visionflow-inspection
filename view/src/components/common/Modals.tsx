import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Button, Modal } from '../common/Modal';

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors placeholder:text-text-tertiary';
const labelClass = 'text-xs text-text-secondary mb-1.5 block';

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
        <div>
          <label className={labelClass}>用户名</label>
          <input type="text" placeholder="输入用户名" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>密码</label>
          <input type="password" placeholder="输入密码" value={pwd}
            onChange={e => setPwd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className={inputClass}
          />
        </div>
        {error && <p className="text-ng text-xs">{error}</p>}
      </div>
    </Modal>
  );
};

export const ChangePwdModal: React.FC = () => {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);

  const handleChange = () => {
    setError('');
    if (!oldPwd || !newPwd || !confirmPwd) { setError('请填写所有密码字段'); return; }
    const { storage } = require('../../services/storage');
    const users = storage.getUsers();
    const u = users.find((x: { id: number }) => x.id === user?.id);
    if (!u) { setError('用户数据异常'); return; }
    if (u.password !== oldPwd) { setError('旧密码错误'); return; }
    if (newPwd.length < 3) { setError('新密码至少3位'); return; }
    if (newPwd !== confirmPwd) { setError('两次新密码不一致'); return; }
    u.password = newPwd;
    storage.saveUsers(users);
    setModal('changePwd', false);
    showMessage('密码修改成功');
  };

  return (
    <Modal open={true} onClose={() => setModal('changePwd', false)} title="修改密码"
      footer={<>
        <Button variant="primary" onClick={handleChange}>确认修改</Button>
        <Button variant="secondary" onClick={() => setModal('changePwd', false)}>取消</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>旧密码</label>
          <input type="password" placeholder="输入当前密码" value={oldPwd} onChange={e => setOldPwd(e.target.value)}
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>新密码</label>
          <input type="password" placeholder="输入新密码" value={newPwd} onChange={e => setNewPwd(e.target.value)}
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>确认新密码</label>
          <input type="password" placeholder="再次输入新密码" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
            className={inputClass} />
        </div>
        {error && <p className="text-ng text-xs">{error}</p>}
      </div>
    </Modal>
  );
};

export const AddProductModal: React.FC = () => {
  const [model, setModel] = useState('');
  const [size, setSize] = useState('');
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);

  const handleAdd = () => {
    if (!model || !size) { showMessage('请填写完整的产品信息'); return; }
    const { storage } = require('../../services/storage');
    const products = storage.getProducts();
    if (products.find((p: { model: string }) => p.model === model)) { showMessage('该型号已存在'); return; }
    products.push({ id: Date.now(), model, size, learned: false });
    storage.saveProducts(products);
    setModal('addProduct', false);
    showMessage(`产品 ${model} 已新增`);
  };

  return (
    <Modal open={true} onClose={() => setModal('addProduct', false)} title="新增产品"
      footer={<>
        <Button variant="primary" onClick={handleAdd}>确认新增</Button>
        <Button variant="secondary" onClick={() => setModal('addProduct', false)}>取消</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>产品型号</label>
          <input type="text" placeholder="例如: JAR-500ml" value={model} onChange={e => setModel(e.target.value)}
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>尺寸规格</label>
          <input type="text" placeholder="例如: 直径73mm x 高120mm" value={size} onChange={e => setSize(e.target.value)}
            className={inputClass} />
        </div>
      </div>
    </Modal>
  );
};

export const LearnConfirmModal: React.FC<{ onConfirm: (upright: string, inverted: string, folder: string) => void }> = ({ onConfirm }) => {
  const [upright, setUpright] = useState('');
  const [inverted, setInverted] = useState('');
  const [folder, setFolder] = useState('');
  const setModal = useAppStore(s => s.setModal);

  const browseFolder = async (setter: (v: string) => void) => {
    try {
      const path = await window.electronAPI?.selectFolder();
      if (path) setter(path);
    } catch { /* ignore */ }
  };

  return (
    <Modal open={true} onClose={() => setModal('learnConfirm', false)} title="确认学习参数" width="520px"
      footer={<>
        <Button variant="learn" onClick={() => onConfirm(upright, inverted, folder)}>确认开始学习</Button>
        <Button variant="secondary" onClick={() => setModal('learnConfirm', false)}>取消</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-secondary">请指定正罐/倒罐图片目录，或指定包含 正/反/ 子目录的父目录</p>
        <div className="flex gap-2">
          <input type="text" placeholder="正罐图片目录" value={upright} onChange={e => setUpright(e.target.value)}
            className={`${inputClass} flex-1`} />
          <Button variant="secondary" size="sm" onClick={() => browseFolder(setUpright)}>浏览</Button>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="倒罐图片目录" value={inverted} onChange={e => setInverted(e.target.value)}
            className={`${inputClass} flex-1`} />
          <Button variant="secondary" size="sm" onClick={() => browseFolder(setInverted)}>浏览</Button>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="父目录（含正/反/子目录）" value={folder} onChange={e => setFolder(e.target.value)}
            className={`${inputClass} flex-1`} />
          <Button variant="secondary" size="sm" onClick={() => browseFolder(setFolder)}>浏览</Button>
        </div>
      </div>
    </Modal>
  );
};
