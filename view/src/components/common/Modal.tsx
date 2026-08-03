import React from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  closeOnBackdrop?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer, width = '440px', closeOnBackdrop = true }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/35 backdrop-blur-[3px] p-4"
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white/95 rounded-lg shadow-modal animate-in border border-white/80"
        style={{ width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' }}
      >
        {title && (
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100/80">
            <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary text-lg leading-none transition-colors"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-5 sm:p-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-3 px-5 sm:px-6 py-4 border-t border-gray-100 bg-surface/80 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
