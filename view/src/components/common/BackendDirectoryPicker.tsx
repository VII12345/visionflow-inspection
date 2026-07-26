import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Button, Modal } from './Modal';

export interface BackendImageDirectory {
  path: string;
  name: string;
  relativePath: string;
  root: string;
  imageCount: number;
}

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onSelect: (directory: BackendImageDirectory) => void;
}

export const BackendDirectoryPicker: React.FC<Props> = ({ open, title, onClose, onSelect }) => {
  const [directories, setDirectories] = useState<BackendImageDirectory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getImageDirectories().then(data => {
      if (cancelled) return;
      if (!data.success) {
        setError('后端未返回可用目录');
        setDirectories([]);
        return;
      }
      setDirectories(data.directories || []);
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(`读取后端目录失败: ${(reason as Error)?.message || '检测服务无响应'}`);
        setDirectories([]);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title} width="720px"
      footer={<Button variant="secondary" onClick={onClose}>取消</Button>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-secondary leading-5">
          以下目录位于后端电脑，列表只显示直接包含图片的目录。选择后会把后端路径填入当前表单。
        </p>
        {loading && <p className="text-xs text-text-tertiary py-8 text-center">正在读取后端图片目录...</p>}
        {!loading && error && <p className="text-xs text-ng bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>}
        {!loading && !error && directories.length === 0 && (
          <p className="text-xs text-text-tertiary bg-gray-50 border border-gray-100 rounded-md px-3 py-8 text-center">
            后端允许的目录中没有找到图片。请将样例放入后端 data 或 test 目录，或配置 VISION_IMAGE_ROOTS 后重试。
          </p>
        )}
        {!loading && directories.length > 0 && (
          <div className="max-h-[420px] overflow-auto border border-gray-100 rounded-md divide-y divide-gray-100">
            {directories.map(directory => (
              <button
                key={directory.path}
                type="button"
                onClick={() => onSelect(directory)}
                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-center gap-3"
              >
                <span className="text-lg shrink-0">🗂️</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-text-primary font-medium truncate">{directory.name}</span>
                  <span className="block text-[11px] text-text-tertiary truncate" title={directory.path}>{directory.path}</span>
                </span>
                <span className="shrink-0 text-[11px] text-text-secondary bg-gray-100 rounded-full px-2 py-1">{directory.imageCount} 张</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
