import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { NoNoteRoute } from "@/features/notes/components/NoteWorkspace";
import { IconPlus } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

// Where you land with no note open, e.g. after closing the last tab: the file tree stays, the editor is empty.
export default async function NoteIndexPage() {
  await requireAuth();
  return <>
    <NoNoteRoute />
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>No note open</EmptyTitle>
        <EmptyDescription>Pick a note from the file tree, or start a new one.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/app/note/new" className={buttonVariants({ variant: "outline" })}><IconPlus data-icon="inline-start" />New note</Link>
      </EmptyContent>
    </Empty>
  </>;
}
