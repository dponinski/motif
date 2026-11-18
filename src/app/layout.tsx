import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import SyncManager from "@/components/sync/SyncManager";

export const metadata: Metadata = {
  title: "Motif — Design System Builder",
  description: "A visual editor for the React components and tokens of a design system",
};

// No `maximum-scale`: pinch-zoom has to stay available to people who need it.
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* FOUC prevention: apply theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('motif-theme')||'{}');var mode=(s&&s.state&&s.state.mode)||'system';var isDark=mode==='dark'||(mode==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',isDark?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <SyncManager />
      </body>
    </html>
  );
}
