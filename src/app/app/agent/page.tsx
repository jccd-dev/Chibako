import { requireAuth } from "@/lib/auth";
import { AgentView } from "@/features/agent/components/AgentView";

export default async function AgentPage() {
  await requireAuth();
  return <AgentView />;
}