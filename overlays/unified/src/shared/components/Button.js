"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "button-primary text-white disabled:!bg-surface-3 disabled:[background-image:none] disabled:text-text-muted",
  secondary: "button-secondary text-text-main hover:border-brand-500/40 hover:bg-surface-2",
  outline: "border border-border bg-transparent text-text-main hover:border-brand-500/45 hover:bg-brand-500/[0.07] hover:text-primary",
  ghost: "text-text-muted hover:bg-brand-500/[0.08] hover:text-primary",
  danger: "bg-red-500 text-white shadow-sm hover:bg-red-600 disabled:bg-surface-3 disabled:text-text-muted",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  sm: "h-8 rounded-[10px] px-3 text-xs",
  md: "h-10 rounded-[12px] px-4 text-sm",
  lg: "h-12 rounded-[14px] px-6 text-sm",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 ease-out",
        "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{iconRight}</span> : null}
    </button>
  );
}
