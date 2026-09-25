import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { getNote, listNotes } from "@/lib/notes";
import { NoteClient } from "@/components/NoteClient";
import { isNoteDate } from "@/features/calendar/note-dates";
import type { ViewMode } from "@/components/NoteClient";

function viewFromCookie(value: string | undefined): ViewMode | undefined {
  return value === "write" || value === "edit" || value === "split" || value === "preview" ? value : undefined;
}

export default async function NotePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requireAuth();
  const initialView = viewFromCookie((await cookies()).get("chibako_view")?.value);
  const { id } = await params;
  if (id === "new") {
    const requestedDate = (await searchParams).date;
    const draftDate = typeof requestedDate === "string" && isNoteDate(requestedDate) ? requestedDate : undefined;
    return <NoteClient initial={null} allNotes={listNotes()} draftDate={draftDate} initialView={initialView} />;
  }
  const note = getNote(id);
  if (!note) {
    const home = listNotes().find((n) => n.kind === "index");
    redirect(home ? `/app/note/${home.id}` : "/app");
  }
  return <NoteClient initial={note} allNotes={listNotes()} initialView={initialView} />;
}
