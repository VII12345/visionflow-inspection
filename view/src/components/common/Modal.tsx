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
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30"
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-xl shadow-modal animate-in"
        style={{ width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' }}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary text-lg leading-none transition-colors"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-surface rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'start' | 'stop' | 'learn' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', children, className = '', ...props }) => {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none';

  const variants: Record<string, string> = {
    primary: 'bg-accent text-white hover:bg-accent-dark',
    secondary: 'bg-white text-text-primary border border-gray-300 hover:bg-gray-50',
    start: 'bg-ok text-white hover:bg-emerald-700',
    stop: 'bg-ng text-white hover:bg-red-700',
    learn: 'bg-accent text-white hover:bg-accent-dark',
    danger: 'bg-white text-ng border border-red-200 hover:bg-red-50',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-gray-100',
  };

  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-[13px]',
    lg: 'px-6 py-2.5 text-sm',
  };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
};

interface BadgeProps {
  variant: 'ok' | 'ng' | 'learned' | 'unlearned' | 'pending' | 'error' | 'admin' | 'tech' | 'operator';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant, children }) => {
  const variants: Record<string, string> = {
    ok: 'bg-emerald-50 text-ok',
    ng: 'bg-red-50 text-ng',
    learned: 'bg-emerald-50 text-ok',
    unlearned: 'bg-amber-50 text-warn',
    pending: 'bg-gray-100 text-text-tertiary',
    error: 'bg-red-50 text-ng',
    admin: 'bg-gray-100 text-text-secondary',
    tech: 'bg-gray-100 text-text-secondary',
    operator: 'bg-gray-100 text-text-secondary',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
};
