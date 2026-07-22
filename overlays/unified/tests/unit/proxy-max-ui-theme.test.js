import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("Proxy Max Midnight Aurora UI", () => {
  it("defines the cool indigo and cyan theme for both display modes", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain('Proxy Max "Midnight Aurora" design system');
    expect(css).toContain("--color-brand-500: #6366f1");
    expect(css).toContain("--color-aurora: #06b6d4");
    expect(css).toContain("--color-bg: #070b14");
    expect(css).toContain(".app-card");
    expect(css).toContain(".button-primary");
  });

  it("keeps shared card icons beside their headings", () => {
    const card = read("src/shared/components/Card.js");
    expect(card).toContain('className="flex min-w-0 items-center gap-3"');
    expect(card).toContain('className="icon-tile size-10 rounded-[13px]"');
    expect(card).not.toMatch(/absolute[^\n]+material-symbols-outlined/);
  });

  it("places metric icons beside their values instead of in card corners", () => {
    const dashboard = read("src/app/(dashboard)/dashboard/DashboardOverview.js");
    const metric = dashboard.slice(dashboard.indexOf("function Metric"), dashboard.indexOf("function EmptyState"));
    expect(metric).toContain('className="flex items-center gap-3"');
    expect(metric).not.toContain("justify-between");
    expect(metric).not.toContain("absolute");
  });

  it("uses the redesigned shared components throughout the shell", () => {
    expect(read("src/shared/components/layouts/DashboardLayout.js")).toContain("app-shell");
    expect(read("src/shared/components/Header.js")).toContain("app-header");
    expect(read("src/shared/components/Sidebar.js")).toContain("app-sidebar");
    expect(read("src/shared/components/Button.js")).toContain("button-primary");
  });
});
