"use client"

import { useHydrated } from "@/lib/use-hydrated"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { IconCircleCheck, IconInfoCircle, IconAlertTriangle, IconAlertOctagon } from "@tabler/icons-react"
import { ActivityOrb } from "@/components/LoadingStatus"

const Toaster = ({ ...props }: ToasterProps) => {
  // next-themes resolves the stored theme during the first client render, which
  // would diverge from the server's "system". Gate on mount so the SSR markup
  // and the hydration render always match; the real theme applies after mount.
  const mounted = useHydrated()
  const { resolvedTheme } = useTheme()
  const theme: ToasterProps["theme"] = mounted ? (resolvedTheme === "light" ? "light" : "dark") : "system"

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <IconCircleCheck className="size-4" />
        ),
        info: (
          <IconInfoCircle className="size-4" />
        ),
        warning: (
          <IconAlertTriangle className="size-4" />
        ),
        error: (
          <IconAlertOctagon className="size-4" />
        ),
        loading: (
          <ActivityOrb size={16} />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
