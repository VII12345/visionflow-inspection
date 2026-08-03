import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'start' | 'stop' | 'learn' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', children, className = '', ...props }) => {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none';

  const variants: Record<string, string> = {
    primary: 'bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent-dark hover:shadow-md',
    secondary: 'bg-white/90 text-text-primary border border-gray-200 shadow-sm hover:bg-gray-50 hover:border-gray-300',
    start: 'bg-ok text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-700',
    stop: 'bg-ng text-white shadow-sm shadow-red-500/20 hover:bg-red-700',
    learn: 'bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent-dark',
    danger: 'bg-white text-ng border border-red-200 hover:bg-red-50 hover:border-red-300',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-accent/5',
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
