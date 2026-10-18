"use client";

import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <NextThemeProvider attribute="class" storageKey="chibako_theme" defaultTheme="dark" enableSystem={false}>{children}</NextThemeProvider>;
}

export function useTheme() {
  const { resolvedTheme, setTheme } = useNextTheme();
  return { theme: resolvedTheme, toggle: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") };
}
