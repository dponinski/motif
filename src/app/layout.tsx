import type { Metadata } from "next";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import SyncManager from "@/components/sync/SyncManager";

export const metadata: Metadata = {
  title: "Motif — Design System Builder",
  description: "A visual editor for the React components and tokens of a design system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {/* FOUC prevention: apply theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('motif-theme')||'{}');var mode=(s&&s.state&&s.state.mode)||'dark';var isDark=mode==='dark'||(mode==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',isDark?'dark':'light');}catch(e){}})();`,
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
