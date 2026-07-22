"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "border-border-subtle bg-surface-2 text-text-muted",
  primary: "border-brand-500/20 bg-brand-500/10 text-brand-600 dark:text-brand-300",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  error: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
  info: "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

const sizes = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

export default function Badge({ children, variant = "default", size = "md", dot = false, icon, className }) {
  const dots = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    info: "bg-cyan-500",
    primary: "bg-brand-500",
    default: "bg-slate-500",
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border font-semibold", variants[variant], sizes[size], className)}>
      {dot ? <span className={cn("size-1.5 rounded-full shadow-[0_0_8px_currentColor]", dots[variant])} /> : null}
      {icon ? <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
