"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Link to a note route. App Router never prefetches dynamic routes, so a plain
 * `<Link>` makes every note switch wait on a server round trip. This one
 * prefetches by default so the click lands on data the client already has.
 * Pass `false` for notes the user is unlikely to open, such as rows in a list
 * where only the highlighted entry should be warm.
 */
export function NoteLink({ noteId, prefetch = true, ...props }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  noteId: string;
  prefetch?: boolean;
}) {
  return <Link {...props} href={`/app/note/${noteId}`} prefetch={prefetch} />;
}
