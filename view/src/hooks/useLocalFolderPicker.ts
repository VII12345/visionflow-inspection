import { useCallback } from 'react';
import { isTauri, pickDirectory } from '../services/native';

/**
 * 本地目录选择（Tauri 返回真实路径；网页版受浏览器限制仅能获取目录名称，并提示改用后端目录）。
 * `hint` 为提示文案中的用途词，例如 "实际测试路径"。
 */
export function useLocalFolderPicker(showMessage: (message: string) => void) {
  return useCallback(async (setter: (value: string) => void, hint: string) => {
    try {
      const selected = await pickDirectory();
      if (!selected) return;
      setter(selected);
      if (!isTauri()) {
        showMessage(`已选择目录（网页版仅能获取目录名称，${hint}请用"选择后端目录"）`);
      }
    } catch (reason) {
      showMessage('选择本地目录失败: ' + (reason as Error).message);
    }
  }, [showMessage]);
}
