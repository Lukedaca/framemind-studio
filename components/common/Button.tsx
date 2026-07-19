import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}

const Button: React.FC<ButtonProps> = ({ variant = 'primary', size = 'md', className = '', ...props }) => {
  const base = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-void rounded-lg';
  
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-white border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_20px_rgba(47,111,224,0.25)] hover:bg-accent-hover hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_24px_rgba(47,111,224,0.45)]',
    secondary: 'bg-elevated text-text-primary border border-border-subtle hover:bg-surface hover:border-text-secondary/30',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-white/5',
    danger: 'bg-error/10 text-error border border-error/20 hover:bg-error/20',
  };

  return (
    <button 
      className={`${base} ${sizes[size]} ${styles[variant]} ${className}`} 
      {...props} 
    />
  );
};

export default Button;