import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy";
import "@/shared/services/bootstrap";
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

initConsoleLogCapture();

export const metadata = {
  title: {
    default: "Proxy Max",
    template: "%s · Proxy Max",
  },
  description: "Local-first multi-provider AI gateway and operations dashboard.",
  applicationName: "Proxy Max",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#11100f" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <RuntimeI18nProvider>{children}</RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
