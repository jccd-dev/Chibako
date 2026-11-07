import { requireAuth } from "@/lib/auth";
import { ensureIndexNote } from "@/lib/notes";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SavedNotesProvider } from "@/features/notes/editor/SavedNotesProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  ensureIndexNote();
  return (
    <div className="flex h-dvh overflow-hidden">
      <TooltipProvider delay={300}>
        <SavedNotesProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </SavedNotesProvider>
      </TooltipProvider>
      <CommandPalette />
    </div>
  );
}
