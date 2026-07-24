import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../..");

describe("Proxy Max integration branding", () => {
  it("uses Proxy Max as the application name", () => {
    const config = fs.readFileSync(path.join(root, "src/shared/constants/config.js"), "utf8");
    expect(config).toContain('name: "Proxy Max"');
  });

  it("offers a Git-backed application update without a global package install", () => {
    const sidebar = fs.readFileSync(path.join(root, "src/shared/components/Sidebar.js"), "utf8");
    expect(sidebar).not.toContain("npm i -g proxy-max");
    expect(sidebar).toContain('fetch("/api/version"');
    expect(sidebar).toContain('fetch("/api/version/update"');
    expect(sidebar).toContain("Check for updates");
    expect(sidebar).toContain("Update Proxy Max");
  });

  it("selects a trusted updater for Git and npm distributions", () => {
    const route = fs.readFileSync(path.join(root, "src/app/api/version/route.js"), "utf8");
    const npmUpdate = fs.readFileSync(path.join(root, "src/lib/npmUpdate.js"), "utf8");
    expect(route).toContain("getGitUpdateStatus");
    expect(route).toContain('"trusted-git-fast-forward"');
    expect(route).toContain("getNpmUpdateStatus");
    expect(route).toContain('"trusted-npm-package"');
    expect(route).not.toContain("registry.npmjs.org");
    expect(route).not.toContain('from "https"');
    expect(npmUpdate).toContain('const REGISTRY_ORIGIN = "https://registry.npmjs.org"');
  });

  it("brands page metadata and keeps the local dashboard free of analytics beacons", () => {
    const layout = fs.readFileSync(path.join(root, "src/app/layout.js"), "utf8");
    expect(layout).toContain('default: "Proxy Max"');
    expect(layout).toContain('applicationName: "Proxy Max"');
    expect(layout).not.toContain("GoogleAnalytics");
    expect(layout).not.toContain("G-LC959F603F");
    expect(layout).not.toContain("next/font/google");
  });

  it("brands first-run login and forces replacement of the built-in password", () => {
    const loginPage = fs.readFileSync(path.join(root, "src/app/login/page.js"), "utf8");
    const loginRoute = fs.readFileSync(path.join(root, "src/app/api/auth/login/route.js"), "utf8");
    expect(loginPage).toContain("Proxy Max");
    expect(loginPage).toContain("First-run security");
    expect(loginRoute).toContain("const mustChangePassword = !storedHash && !process.env.INITIAL_PASSWORD");
    expect(loginRoute).toContain("npm run proxy-max:reset-password");
    const settingsRoute = fs.readFileSync(path.join(root, "src/app/api/settings/route.js"), "utf8");
    expect(settingsRoute).toContain("body.newPassword.length < 8");
  });

  it("adds browser security headers at the single request edge", () => {
    const requestProxy = fs.readFileSync(path.join(root, "src/proxy.js"), "utf8");
    expect(requestProxy).toContain('"Content-Security-Policy"');
    expect(requestProxy).toContain('"frame-ancestors \'none\'"');
    expect(requestProxy).toContain('"X-Content-Type-Options": "nosniff"');
    expect(requestProxy).toContain('"Referrer-Policy": "no-referrer"');
  });

  it("keeps the mobile shell keyboard-safe and names icon-only controls", () => {
    const dashboardLayout = fs.readFileSync(path.join(root, "src/shared/components/layouts/DashboardLayout.js"), "utf8");
    const headerMenu = fs.readFileSync(path.join(root, "src/shared/components/HeaderMenu.js"), "utf8");
    const headerLanguage = fs.readFileSync(path.join(root, "src/shared/components/HeaderLanguage.js"), "utf8");
    expect(dashboardLayout).toContain("inert={!sidebarOpen}");
    expect(dashboardLayout).toContain("inert={sidebarOpen}");
    expect(headerMenu).toContain('aria-label="Open application menu"');
    expect(headerMenu).toContain('role="menu"');
    expect(headerLanguage).toContain('aria-label={`Select language, current ${locale}`}');
  });
});
