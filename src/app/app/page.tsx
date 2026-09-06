import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { listNotes, ensureIndexNote } from "@/lib/notes";

export default async function AppIndex() {
  await requireAuth();
  ensureIndexNote();
  const notes = listNotes();
  const home = notes.find((n) => n.kind === "index");
  const first = notes[0];
  const target = home ?? first;
  if (target) redirect(`/app/note/${target.id}`);
  redirect("/app/note/new");
}