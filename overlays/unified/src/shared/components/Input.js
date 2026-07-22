"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

export default function Input({
  id,
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  ...props
}) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const descriptionId = error
    ? `${controlId}-error`
    : hint
      ? `${controlId}-hint`
      : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={controlId} className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="group relative">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-muted transition-colors group-focus-within:text-primary" aria-hidden="true">
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
          </div>
        )}
        <input
          id={controlId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={descriptionId}
          className={cn(
            "w-full rounded-[12px] border border-border bg-surface/75 px-3 py-2.5 text-sm text-text-main shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
            "placeholder-text-muted/65 hover:border-brand-500/25 hover:bg-surface",
            "focus:border-brand-500/55 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-500/10",
            "transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50",
            "text-[16px] sm:text-sm",
            icon && "pl-10",
            error && "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40",
            inputClassName
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={`${controlId}-error`} className="text-xs text-red-500 flex items-center gap-1" role="alert">
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${controlId}-hint`} className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
