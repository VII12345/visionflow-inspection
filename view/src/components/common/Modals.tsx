import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { storage } from '../../services/storage';
import { BackendDirectoryPicker, type BackendImageDirectory } from './BackendDirectoryPicker';
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
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [size, setSize] = useState('');
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const refreshCatalog = useAppStore(s => s.refreshCatalog);

  const handleAdd = () => {
    const displayName = name.trim() || model.trim();
    const modelKey = model.trim();
    if (!displayName || !modelKey || !size.trim()) { showMessage('请填写完整的产品信息'); return; }
    const products = storage.getProducts();
    if (products.find(p => p.model === modelKey || p.name === displayName)) { showMessage('该产品名称或模型标识已存在'); return; }
    products.push({ id: Date.now(), name: displayName, model: modelKey, size: size.trim(), learned: false });
    storage.saveProducts(products);
    refreshCatalog();
    setModal('addProduct', false);
    showMessage(`产品 ${displayName} 已新增`);
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
          <label className={labelClass}>产品名称</label>
          <input type="text" placeholder="例如：成品一号" value={name} onChange={e => setName(e.target.value)}
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>模型标识</label>
          <input type="text" placeholder="例如：PRODUCT-500ml" value={model} onChange={e => setModel(e.target.value)}
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

export const LearnConfirmModal: React.FC<{ onConfirm: (categoryRoot: string) => void }> = ({ onConfirm }) => {
  const [categoryRoot, setCategoryRoot] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);

  const browseLocalFolder = async () => {
    if (!window.electronAPI?.selectFolder) {
      showMessage('网页版暂不支持选择当前电脑的本地文件夹，请使用“选择后端目录”');
      return;
    }
    try {
      const path = await window.electronAPI.selectFolder();
      if (path) setCategoryRoot(path);
    } catch (error) {
      showMessage(`选择本地目录失败: ${(error as Error).message}`);
    }
  };

  const applyDirectory = (directory: BackendImageDirectory) => {
    setCategoryRoot(directory.path);
    setPickerOpen(false);
  };

  return (
    <>
      <Modal open={true} onClose={() => setModal('learnConfirm', false)} title="确认学习参数" width="520px"
        footer={<>
          <Button variant="learn" onClick={() => onConfirm(categoryRoot)}>确认开始学习</Button>
          <Button variant="secondary" onClick={() => setModal('learnConfirm', false)}>取消</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-text-secondary leading-5">请选择类别根目录。根目录下每个子文件夹代表一个类别，类别数量不限；例如可以同时包含“合格”“缺陷”“划伤”“异物”等多个子目录。</p>
          <div>
            <label className={labelClass}>类别根目录</label>
            <div className="flex gap-2">
              <input type="text" placeholder="选择包含多个类别子目录的文件夹" value={categoryRoot} onChange={e => setCategoryRoot(e.target.value)} className={`${inputClass} flex-1`} />
              <Button variant="secondary" size="sm" onClick={browseLocalFolder}>选择本地目录</Button>
              <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>选择后端目录</Button>
            </div>
          </div>
          <p className="text-[11px] text-text-tertiary">每个类别子目录至少需要包含一张图片，系统会按子目录名称保存类别标签。</p>
        </div>
      </Modal>
      <BackendDirectoryPicker open={pickerOpen} title="选择后端类别根目录" onClose={() => setPickerOpen(false)} onSelect={applyDirectory} />
    </>
  );
};
