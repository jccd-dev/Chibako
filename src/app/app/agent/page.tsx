import { requireAuth } from "@/lib/auth";
import { AgentView } from "@/components/AgentView";

export default async function AgentPage() {
  await requireAuth();
  return <AgentView />;
}