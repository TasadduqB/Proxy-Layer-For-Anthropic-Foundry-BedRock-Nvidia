"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}) {
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-5 sm:p-6",
    lg: "p-6 sm:p-8",
  };

  return (
    <div
      className={cn(
        "app-card rounded-[20px]",
        elev && "shadow-[var(--shadow-elev)]",
        hover && "app-card-interactive cursor-pointer transition-all duration-200",
        paddings[padding],
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <div className="icon-tile size-10 rounded-[13px]">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{icon}</span>
              </div>
            ) : null}
            <div className="min-w-0">
              {title ? <h3 className="truncate font-semibold tracking-[-0.01em] text-text-main">{title}</h3> : null}
              {subtitle ? <p className="mt-0.5 text-xs leading-5 text-text-muted sm:text-sm">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0 pt-1">{action}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-border-subtle bg-bg/60 p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "-mx-3 border-b border-border-subtle p-3 px-3 transition-colors last:border-b-0 hover:bg-surface-2/50",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({ children, actions, className, ...props }) {
  return (
    <div
      className={cn(
        "group -mx-3 flex items-center justify-between border-b border-border-subtle p-3 px-3 transition-colors last:border-b-0 hover:bg-surface-2/50",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">{actions}</div> : null}
    </div>
  );
};
