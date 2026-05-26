import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { Loader2 } from 'lucide-react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  key?: React.Key;
}

export function Card({ children, className, onClick, ...props }: CardProps) {
  const { onDrag, onDragStart, onDragEnd, ...safeProps } = props as any;
  return (
    <motion.div
      whileTap={onClick ? { scale: 0.97, y: 2 } : undefined}
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      className={cn(
        "bg-white rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100/50 transition-all duration-300",
        onClick && "cursor-pointer hover:shadow-[0_20px_40px_rgb(0,0,0,0.06)] active:bg-gray-50",
        className
      )}
      {...safeProps}
    >
      {children}
    </motion.div>
  );
}

export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md',
  className,
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const variants = {
    primary: 'bg-blue-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.2)] active:shadow-none hover:bg-blue-700',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
    outline: 'border-2 border-blue-600/20 text-blue-600 hover:bg-blue-50',
    ghost: 'text-slate-500 hover:bg-slate-100'
  };

  const sizes = {
    sm: 'px-4 py-2 text-sm rounded-xl',
    md: 'px-6 py-3 rounded-2xl font-semibold',
    lg: 'px-8 py-4 text-lg font-bold rounded-2xl',
    xl: 'px-10 py-5 text-xl font-black rounded-3xl w-full'
  };

  const { onDrag, onDragStart, onDragEnd, ...safeProps } = props as any;

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={cn(
        "inline-flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...safeProps}
    >
      {children}
    </motion.button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full px-5 py-2.5 h-12 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all",
        className
      )}
      {...props}
    />
  );
}

export function Select({ children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full px-5 py-2.5 h-12 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:bg-white transition-all cursor-pointer md:pr-10",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({ children, variant = 'blue', className }: { children: React.ReactNode, variant?: 'blue' | 'green' | 'red' | 'slate' | 'amber', className?: string }) {
  const styles = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-50 text-slate-600',
    amber: 'bg-amber-50 text-amber-600'
  };
  return (
    <span className={cn("px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest", styles[variant], className)}>
      {children}
    </span>
  );
}

export function Loader({ fullScreen, label = "Processing Request" }: { fullScreen?: boolean, label?: string }) {
  const content = (
    <div className={cn(
      "flex flex-col items-center justify-center space-y-4", 
      fullScreen ? "fixed inset-0 z-[100] bg-white/90 backdrop-blur-md" : "p-10 w-full"
    )}>
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative"
      >
        <div className="w-16 h-16 border-4 border-slate-100 rounded-full" />
        <Loader2 className="absolute top-0 left-0 w-16 h-16 text-blue-600 animate-spin" strokeWidth={2.5} />
      </motion.div>
      <div className="flex flex-col items-center space-y-1">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] animate-pulse">{label}</p>
        <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Please do not refresh</p>
      </div>
    </div>
  );
  
  return content;
}
