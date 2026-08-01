import { useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { openCameraPopout, subscribeCameraPopoutClosed } from '../../services/native';

/** 相机弹窗/弹出窗口逻辑（含 Tauri 子窗口关闭事件订阅）。 */
export const useCameraPopout = (canEditRun: boolean) => {
  const showMessage = useAppStore(s => s.showMessage);
  const togglePopoutCam = useAppStore(s => s.togglePopoutCam);

  // Listen for camera popout close events from Tauri child windows.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    subscribeCameraPopoutClosed((camId: number) => {
      togglePopoutCam(camId);
    }).then(cleanup => {
      if (active) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [togglePopoutCam]);

  const handlePopout = useCallback(async (camId: number) => {
    if (!canEditRun) return;
    try {
      await openCameraPopout(camId);
      togglePopoutCam(camId);
    } catch (error) {
      showMessage(`打开相机窗口失败: ${(error as Error).message}`);
    }
  }, [canEditRun, showMessage, togglePopoutCam]);

  return { handlePopout };
};
