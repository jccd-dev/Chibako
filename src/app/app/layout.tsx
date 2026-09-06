import { requireAuth } from "@/lib/auth";
import { ensureIndexNote } from "@/lib/notes";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  ensureIndexNote();
  return (
    <div className="flex h-screen overflow-hidden">
      <TooltipProvider delay={300}>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </TooltipProvider>
      <CommandPalette />
    </div>
  );
}