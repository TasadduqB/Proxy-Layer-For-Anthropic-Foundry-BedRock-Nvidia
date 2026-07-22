"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="app-shell flex h-dvh w-full overflow-hidden">
      <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0">
        Skip to content
      </a>
      <div className="fixed right-4 top-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite" aria-atomic="false">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              role={n.type === "error" ? "alert" : "status"}
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Sidebar - Mobile */}
      <div
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main
        id="main-content"
        aria-hidden={sidebarOpen ? true : undefined}
        inert={sidebarOpen}
        className="relative isolate flex h-full min-w-0 flex-1 flex-col transition-colors duration-300"
        tabIndex={-1}
      >
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <div className={`custom-scrollbar flex-1 overflow-y-auto ${pathname === "/dashboard/basic-chat" ? "" : "p-4 sm:p-6 xl:p-8"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${pathname === "/dashboard/basic-chat" ? "flex h-full w-full flex-1 flex-col" : "mx-auto w-full max-w-[1600px]"}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
