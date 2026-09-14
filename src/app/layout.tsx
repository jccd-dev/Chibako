import type { Metadata } from "next";
import localFont from "next/font/local";
import { Source_Sans_3, Figtree } from "next/font/google";
import { AppearanceProvider } from "@/components/AppearanceProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ChibakoToaster } from "@/components/ChibakoToaster";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import "./globals.css";

const dmSans = localFont({
  src: "../../public/fonts/DMSans.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "swap",
  preload: true,
});
const questrial = localFont({
  src: "../../public/fonts/Questrial.woff2",
  weight: "400",
  variable: "--font-questrial",
  display: "swap",
  preload: false,
});
const quicksand = localFont({
  src: "../../public/fonts/Quicksand.woff2",
  weight: "300 700",
  variable: "--font-quicksand",
  display: "swap",
  preload: false,
});
const figtreeHeading = Figtree({ subsets: ["latin"], variable: "--font-figtree", preload: false });
const sourceSans3 = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans", preload: false });

function AppearanceInitScript() {
  return (
    <script
      id="chibako-appearance"
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }}
    />
  );
}

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
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans",
        dmSans.variable,
        questrial.variable,
        quicksand.variable,
        sourceSans3.variable,
        figtreeHeading.variable
      )}
    >
      <head><AppearanceInitScript /></head>
      <body>
        <ThemeProvider>
          <AppearanceProvider>{children}<ChibakoToaster /></AppearanceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
