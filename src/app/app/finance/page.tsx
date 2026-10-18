import { FinanceView } from "@/features/finance/components/FinanceView";

export default async function FinancePage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <FinanceView initialTab={(await searchParams).tab} />;
}
