import React from 'react';

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
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
};
