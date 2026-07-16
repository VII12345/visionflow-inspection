import React from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer, width = '450px' }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[#111620] border border-white/[0.06] rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{ width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' }}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <h3 className="text-[15px] font-semibold text-white">{title}</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white text-xl leading-none transition-colors"
            >
              &times;
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
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
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200 active:scale-[0.97] disabled:opacity-35 disabled:cursor-not-allowed disabled:pointer-events-none';

  const variants: Record<string, string> = {
    primary: 'bg-[#5b6ef5] text-white border border-[#5b6ef5] hover:bg-[#7b8cf8] hover:shadow-[0_2px_16px_rgba(91,110,245,0.25)]',
    secondary: 'bg-[#252d3d] text-gray-400 border border-white/[0.09] hover:bg-[#1e2534] hover:text-white hover:border-white/[0.14]',
    start: 'bg-emerald-500 text-white border border-emerald-500 font-bold hover:bg-emerald-400 hover:shadow-[0_4px_24px_rgba(16,185,129,0.3)]',
    stop: 'bg-rose-500 text-white border border-rose-500 font-bold hover:bg-rose-400 hover:shadow-[0_4px_24px_rgba(244,63,94,0.3)]',
    learn: 'bg-violet-500 text-white border border-violet-500 hover:bg-violet-400 hover:shadow-[0_2px_16px_rgba(139,92,246,0.3)]',
    danger: 'bg-rose-500/20 text-rose-400 border border-rose-500/20 hover:bg-rose-500/30 hover:text-rose-300',
    ghost: 'bg-transparent text-gray-400 hover:text-white hover:bg-white/[0.05]',
  };

  const sizes: Record<string, string> = {
    sm: 'px-3.5 py-1.5 text-xs rounded-md',
    md: 'px-5 py-2.5 text-[13px] rounded-lg',
    lg: 'px-9 py-3 text-sm rounded-xl',
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
    ok: 'bg-emerald-500/15 text-emerald-400',
    ng: 'bg-rose-500/15 text-rose-400',
    learned: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
    unlearned: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
    pending: 'bg-gray-500/15 text-gray-400',
    error: 'bg-rose-500/15 text-rose-400 border border-rose-500/20',
    admin: 'bg-rose-500/15 text-rose-400',
    tech: 'bg-blue-500/15 text-blue-400',
    operator: 'bg-emerald-500/15 text-emerald-400',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${variants[variant]}`}>
      {children}
    </span>
  );
};
