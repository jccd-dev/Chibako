"use client";

import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/components/ThemeProvider";

export function ChibakoToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme ?? "system"} position="bottom-right" toastOptions={{}} />;
}
