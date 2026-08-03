import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useLocalFolderPicker } from '../../../hooks/useLocalFolderPicker';
import { BackendDirectoryPicker, type BackendImageDirectory } from '../BackendDirectoryPicker';
import { FieldHint } from '../FieldHint';
import { Button } from '../Button';
import { Modal } from '../Modal';
import { inputClass, labelClass } from './modalFields';

export const LearnConfirmModal: React.FC<{ onConfirm: (categoryRoot: string) => void }> = ({ onConfirm }) => {
  const [categoryRoot, setCategoryRoot] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const setModal = useAppStore(s => s.setModal);
  const showMessage = useAppStore(s => s.showMessage);

  const browseLocalFolder = useLocalFolderPicker(showMessage);

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
          <p className="text-xs text-text-secondary leading-5">请选择类别根目录。根目录下每个子文件夹代表一个类别，类别数量不限；例如可以同时包含"合格""缺陷""划伤""异物"等多个子目录。</p>
          <div>
            <label className={labelClass}><FieldHint text="选择训练数据的根目录；下面每个有图片的子目录都会成为一个类别。">类别根目录</FieldHint></label>
            <div className="flex gap-2">
              <input type="text" placeholder="选择包含多个类别子目录的文件夹" value={categoryRoot} onChange={e => setCategoryRoot(e.target.value)} className={`${inputClass} flex-1`} />
              <Button variant="secondary" size="sm" onClick={() => browseLocalFolder(setCategoryRoot, '实际训练路径')}>选择本地目录</Button>
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
