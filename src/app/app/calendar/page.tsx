import { requireAuth } from "@/lib/auth";
import { CalendarView } from "@/features/calendar/components/CalendarView";
import { listDatedNotes } from "@/features/calendar/dated-notes";
import { folderTree } from "@/features/organization/folders";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[]; folder?: string | string[]; tasks?: string | string[] }>;
}) {
  await requireAuth();
  const { date, folder, tasks } = await searchParams;
  return (
    <CalendarView
      initialNotes={listDatedNotes()}
      vaultFolders={folderTree()}
      requestedDate={typeof date === "string" ? date : undefined}
      requestedFolder={typeof folder === "string" ? folder : undefined}
      requestedTasksOnly={tasks === "1"}
    />
  );
}
