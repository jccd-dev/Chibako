import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getNote, listNotes } from "@/lib/notes";
import { NoteClient } from "@/components/NoteClient";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  if (id === "new") {
    return <NoteClient initial={null} allNotes={listNotes()} />;
  }
  const note = getNote(id);
  if (!note) {
    const home = listNotes().find((n) => n.kind === "index");
    redirect(home ? `/app/note/${home.id}` : "/app");
  }
  return <NoteClient initial={note} allNotes={listNotes()} />;
}