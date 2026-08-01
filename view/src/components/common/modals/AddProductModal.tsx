import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { storage } from '../../../services/storage';
import { Button, Modal } from '../Modal';
import { ModalTextField } from './modalFields';

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
        <ModalTextField label="产品名称" hint="填写用户在界面中看到的产品名称，可以随时修改。" placeholder="例如：成品一号" value={name} onChange={setName} />
        <ModalTextField label="模型标识" hint="填写模型的稳定标识，用于保存和匹配训练模型。建议使用英文、数字或短横线。" placeholder="例如：PRODUCT-500ml" value={model} onChange={setModel} />
        <ModalTextField label="尺寸规格" hint="填写产品规格说明，仅用于界面显示和管理。" placeholder="例如: 直径73mm x 高120mm" value={size} onChange={setSize} />
      </div>
    </Modal>
  );
};
