import { requireAuth } from "@/lib/auth";
import { listNotes } from "@/lib/notes";
import { getPropertyDefs } from "@/lib/properties";
import { TasksView } from "@/features/calendar/components/TasksView";

export default async function TasksPage({ searchParams }: {
  searchParams: Promise<{ type?: string | string[]; folder?: string | string[] }>;
}) {
  await requireAuth();
  const { type, folder } = await searchParams;
  const defs = getPropertyDefs();
  const options = (name: string) => defs.find((def) => def.name === name && def.type === "select")?.options ?? [];
  // No ?type= means the default task view; ?type=all clears the filter.
  const requestedType = typeof type === "string" ? (type === "all" ? "" : type) : "task";
  return (
    <TasksView
      initialNotes={listNotes()}
      typeOptions={options("type")}
      statusOptions={options("status")}
      requestedType={requestedType}
      requestedFolder={typeof folder === "string" ? folder : ""}
    />
  );
}
