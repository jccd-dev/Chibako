import { requireAuth } from "@/lib/auth";
import { listNotes } from "@/lib/notes";
import { getPropertyDefs } from "@/lib/properties";
import { folderTree } from "@/features/organization/folders";
import { TasksView } from "@/features/calendar/components/TasksView";
import { parseChoices } from "@/features/calendar/task-table";

export default async function TasksPage({ searchParams }: {
  searchParams: Promise<{ folder?: string | string[]; status?: string | string[]; priority?: string | string[] }>;
}) {
  await requireAuth();
  const { folder, status, priority } = await searchParams;
  const defs = getPropertyDefs();
  const options = (name: string) => defs.find((def) => def.name === name && def.type === "select")?.options ?? [];
  return (
    <TasksView
      key={JSON.stringify([folder, status, priority])}
      initialNotes={listNotes()}
      vaultFolders={folderTree()}
      statusOptions={options("status")}
      priorityOptions={options("priority")}
      requestedFolder={typeof folder === "string" ? folder : ""}
      requestedChoices={{ status: parseChoices(status, options("status")), priority: parseChoices(priority, options("priority")) }}
    />
  );
}
