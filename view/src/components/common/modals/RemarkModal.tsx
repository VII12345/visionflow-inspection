import React, { useState } from 'react';
import { storage } from '../../../services/storage';
import { useAppStore } from '../../../store/useAppStore';
import type { Product } from '../../../types';
import { Button } from '../Button';
import { FieldHint } from '../FieldHint';
import { Modal } from '../Modal';
import { inputClass, labelClass } from '../uiClasses';

interface Props {
  product: Product;
  onClose: () => void;
}

/** 产品备注编辑弹窗：点击窗口外不关闭，未保存退出前先提示确认。 */
export const RemarkModal: React.FC<Props> = ({ product, onClose }) => {
  const user = useAppStore(s => s.user);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);
  const refreshCatalog = useAppStore(s => s.refreshCatalog);
  // 从 storage 读最新值，避免父组件传入的产品对象过期（设置页列表 10s 轮询）。
  const saved = storage.getProducts().find(p => p.id === product.id)?.remark ?? '';
  const [value, setValue] = useState(saved);
  const [initialValue] = useState(saved);
  const [stage, setStage] = useState<'edit' | 'confirm'>('edit');

  const requireEditPermission = (): boolean => {
    if (!user) { setModal('login', true); return false; }
    if (user.level !== 'admin' && user.level !== 'tech') {
      showMessage('需要技术员或以上权限才能修改检测配置');
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!requireEditPermission()) return;
    const next = storage.getProducts().map(item =>
      item.id === product.id ? { ...item, remark: value } : item
    );
    storage.saveProducts(next);
    refreshCatalog();
    showMessage(`产品「${product.name || product.model}」备注已保存`);
    onClose();
  };

  const requestClose = () => {
    if (stage === 'confirm') return;
    if (value !== initialValue) { setStage('confirm'); return; }
    onClose();
  };

  return (
    <Modal
      open
      closeOnBackdrop={false}
      onClose={requestClose}
      title={`产品备注 · ${product.name || product.model}`}
      width="460px"
      footer={
        stage === 'confirm' ? (
          <>
            <Button variant="secondary" onClick={() => setStage('edit')}>继续编辑</Button>
            <Button variant="danger" onClick={onClose}>放弃退出</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={handleSave}>保存</Button>
            <Button variant="secondary" onClick={requestClose}>取消</Button>
          </>
        )
      }
    >
      {stage === 'confirm' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-text-primary">备注尚未保存，是否退出？</p>
          <p className="text-xs text-text-tertiary">未保存的内容将会丢失。</p>
        </div>
      ) : (
        <div>
          <label className={labelClass}><FieldHint text="备注仅用于界面显示，不影响检测逻辑。">产品备注</FieldHint></label>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={5}
            autoFocus
            className={`${inputClass} resize-y min-h-[120px]`}
            placeholder="填写该产品的备注信息，例如工艺要求、注意事项等…"
          />
        </div>
      )}
    </Modal>
  );
};
