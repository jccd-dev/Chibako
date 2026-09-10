import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ChibakoToaster } from "@/components/ChibakoToaster";
import "./globals.css";
import { Source_Sans_3, Figtree } from "next/font/google";
import { cn } from "@/lib/utils";

const figtreeHeading = Figtree({subsets:['latin'],variable:'--font-figtree'});

const sourceSans3 = Source_Sans_3({subsets:['latin'],variable:'--font-source-sans'});

export const metadata: Metadata = {
  title: { default: "Chibako", template: "%s · Chibako" },
  description: "Self-hosted Obsidian-like second brain with AI agent access.",
  icons: {
    icon: [
      { url: "/favicon_io/favicon.ico" },
      { url: "/favicon_io/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon_io/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/favicon_io/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", sourceSans3.variable, figtreeHeading.variable)}>
      <body><ThemeProvider>{children}<ChibakoToaster /></ThemeProvider></body>
    </html>
  );
}