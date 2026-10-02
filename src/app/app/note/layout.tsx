import type { ReactNode } from "react";
import { NoteWorkspace } from "@/components/NoteWorkspace";

export default function NoteLayout({ children }: { children: ReactNode }) {
  return <NoteWorkspace>{children}</NoteWorkspace>;
}
