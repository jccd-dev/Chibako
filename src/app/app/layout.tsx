import { requireAuth } from "@/lib/auth";
import { ensureIndexNote } from "@/lib/notes";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CommandPalette } from "@/components/CommandPalette";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  ensureIndexNote();
  return (
    <div className="flex h-dvh overflow-hidden">
      <TooltipProvider delay={300}>
        <WorkspaceShell>{children}</WorkspaceShell>
      </TooltipProvider>
      <CommandPalette />
    </div>
  );
}