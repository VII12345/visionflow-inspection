import React from 'react';
import { api } from '../../services/api';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  camId: number;
  photoId: string;
  children: React.ReactNode;
}

/** 照片右键操作：右键另存下载。 */
export const PhotoContextMenu: React.FC<Props> = ({ camId, photoId, children }) => {
  const showMessage = useAppStore(s => s.showMessage);

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = api.getPhotoUrl(camId, photoId);
    const a = document.createElement('a');
    a.href = url;
    a.download = photoId;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showMessage(`图片已下载: ${photoId}`);
  };

  return (
    <div onContextMenu={handleRightClick} className="contents">
      {children}
    </div>
  );
};
