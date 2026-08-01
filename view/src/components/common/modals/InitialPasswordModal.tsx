import React, { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { Button, Modal } from '../Modal';

interface Props {
  username: string;
  password: string;
  onClose: () => void;
}

export const InitialPasswordModal: React.FC<Props> = ({ username, password, onClose }) => {
  const showMessage = useAppStore(s => s.showMessage);
  const setModal = useAppStore(s => s.setModal);
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(password);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = password;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      showMessage('初始密码已复制，请妥善保存');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showMessage('复制失败，请手动记下密码');
    }
  };

  const goLogin = () => {
    onClose();
    setModal('login', true);
  };

  return (
    <Modal open={true} onClose={onClose} title="首次启动初始化" width="460px" closeOnBackdrop={false}
      footer={<>
        <Button variant="secondary" onClick={copyPassword}>{copied ? '已复制' : '复制密码'}</Button>
        <Button variant="secondary" onClick={goLogin}>前往登录</Button>
        <Button variant="primary" onClick={onClose}>我知道了</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-text-secondary leading-relaxed">
          检测到首次启动，系统已自动创建默认管理员账号。初始密码如下，请妥善保存，登录后请尽快修改。
        </p>
        <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-tertiary">用户名</span>
            <span className="text-[13px] font-medium text-text-primary">{username}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <span className="text-xs text-text-tertiary shrink-0">初始密码</span>
            <code className="text-[16px] font-mono font-semibold tracking-wider text-accent select-all break-all text-right">{password}</code>
          </div>
        </div>
      </div>
    </Modal>
  );
};
