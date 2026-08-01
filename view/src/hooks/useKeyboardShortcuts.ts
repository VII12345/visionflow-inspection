import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/** 全局快捷键处理（ESC 关闭所有弹窗）。 */
export const useKeyboardShortcuts = () => {
  const setModal = useAppStore(s => s.setModal);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal('all', false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setModal]);
};
