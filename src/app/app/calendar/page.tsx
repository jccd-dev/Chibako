import { requireAuth } from "@/lib/auth";
import { CalendarView } from "@/components/CalendarView";
import { listDatedNotes } from "@/features/calendar/dated-notes";

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requireAuth();
  const date = (await searchParams).date;
  return <CalendarView initialNotes={listDatedNotes()} requestedDate={typeof date === "string" ? date : undefined} />;
}
