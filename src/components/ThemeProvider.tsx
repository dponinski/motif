"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/store/theme";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeStore();

  useEffect(() => {
    const apply = (isDark: boolean) => {
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    };

    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      apply(mode === "dark");
    }
  }, [mode]);

  return <>{children}</>;
}
