import { requireAuth } from "@/lib/auth";
import { listNotes } from "@/lib/notes";
import { getPropertyDefs } from "@/lib/properties";
import { folderTree } from "@/features/organization/folders";
import { TasksView } from "@/features/calendar/components/TasksView";
import { parseChoices } from "@/features/calendar/task-table";

export default async function TasksPage({ searchParams }: {
  searchParams: Promise<{ type?: string | string[]; folder?: string | string[]; status?: string | string[]; priority?: string | string[] }>;
}) {
  await requireAuth();
  const { type, folder, status, priority } = await searchParams;
  const defs = getPropertyDefs();
  const options = (name: string) => defs.find((def) => def.name === name && def.type === "select")?.options ?? [];
  // No ?type= means the default task view; ?type=all clears the filter.
  const requestedType = typeof type === "string" ? (type === "all" ? "" : type) : "task";
  return (
    <TasksView
      initialNotes={listNotes()}
      vaultFolders={folderTree()}
      typeOptions={options("type")}
      statusOptions={options("status")}
      priorityOptions={options("priority")}
      requestedType={requestedType}
      requestedFolder={typeof folder === "string" ? folder : ""}
      requestedChoices={{ status: parseChoices(status, options("status")), priority: parseChoices(priority, options("priority")) }}
    />
  );
}
