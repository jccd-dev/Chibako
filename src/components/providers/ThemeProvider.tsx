"use client";

import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";

function ThemeColor() {
  const { resolvedTheme } = useNextTheme();
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", resolvedTheme === "light" ? "#eff1ed" : "#19191a"
    );
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <NextThemeProvider attribute="class" storageKey="chibako_theme" defaultTheme="dark" enableSystem={false}>
    <ThemeColor />
    {children}
  </NextThemeProvider>;
}

export function useTheme() {
  const { resolvedTheme, setTheme } = useNextTheme();
  return { theme: resolvedTheme, toggle: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") };
}
