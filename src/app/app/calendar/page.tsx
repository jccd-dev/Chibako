import { requireAuth } from "@/lib/auth";
import { CalendarView } from "@/features/calendar/components/CalendarView";
import { listDatedNotes } from "@/features/calendar/dated-notes";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[]; folder?: string | string[] }>;
}) {
  await requireAuth();
  const { date, folder } = await searchParams;
  return (
    <CalendarView
      initialNotes={listDatedNotes()}
      requestedDate={typeof date === "string" ? date : undefined}
      requestedFolder={typeof folder === "string" ? folder : undefined}
    />
  );
}
