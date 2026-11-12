import { requireAuth } from "@/lib/auth";
import { CalendarView } from "@/features/calendar/components/CalendarView";
import { listDatedNotes } from "@/features/calendar/dated-notes";
import { folderTree } from "@/features/organization/folders";
import { getPropertyDefs } from "@/lib/properties";
import { parseChoices } from "@/features/calendar/task-table";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{
    date?: string | string[]; folder?: string | string[]; tasks?: string | string[]; status?: string | string[]; priority?: string | string[];
  }>;
}) {
  await requireAuth();
  const { date, folder, tasks, status, priority } = await searchParams;
  const defs = getPropertyDefs();
  const options = (name: string) => defs.find((def) => def.name === name && def.type === "select")?.options ?? [];
  return (
    <CalendarView
      initialNotes={listDatedNotes()}
      vaultFolders={folderTree()}
      statusOptions={options("status")}
      priorityOptions={options("priority")}
      requestedDate={typeof date === "string" ? date : undefined}
      requestedFolder={typeof folder === "string" ? folder : undefined}
      requestedTasksOnly={tasks === "1"}
      requestedChoices={{ status: parseChoices(status, options("status")), priority: parseChoices(priority, options("priority")) }}
    />
  );
}
