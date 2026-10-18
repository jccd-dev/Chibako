import { requireAuth } from "@/lib/auth";
import { SettingsView } from "@/features/settings/components/SettingsView";

export default async function SettingsPage() {
  await requireAuth();
  return <SettingsView />;
}