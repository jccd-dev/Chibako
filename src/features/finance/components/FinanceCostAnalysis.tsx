"use client";

import { Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPHP as money } from "@/features/finance/presentation";
import type { FinanceReportsController } from "@/features/finance/use-finance-reports";

export function FinanceCostAnalysis({
  report,
  onCategoryFilter,
}: {
  report: FinanceReportsController["report"];
  onCategoryFilter: (categoryId: string) => void;
}) {
  const categories = [...(report?.categories ?? [])]
    .filter(category => category.spending_cents > 0)
    .sort((a, b) => b.spending_cents - a.spending_cents);
  const total = categories.reduce((sum, category) => sum + category.spending_cents, 0);
  const data = categories.slice(0, 5).map((category, index) => ({
    name: category.name,
    value: category.spending_cents,
    categoryId: category.category_id,
    fill: `var(--chart-${index + 1})`,
  }));
  const remaining = categories.slice(5).reduce((sum, category) => sum + category.spending_cents, 0);
  if (remaining > 0) data.push({ name: "Remaining categories", value: remaining, categoryId: null, fill: "var(--muted-foreground)" });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Cost analysis</CardTitle>
        <CardDescription>Spending by category</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-2xl font-semibold tabular-nums">{money(report?.spending_cents ?? 0)}</p>
        {data.length ? (
          <>
            <ChartContainer config={{ value: { label: "Spending" } }} className="h-44 w-full aspect-auto" aria-label="Category spending pie chart">
              <PieChart accessibilityLayer>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(value, name) => (
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-medium tabular-nums">{money(Number(value))}</span>
                  </div>
                )} />} />
                <Pie data={data} dataKey="value" nameKey="name" outerRadius="90%" stroke="var(--card)" strokeWidth={2} isAnimationActive={false} />
              </PieChart>
            </ChartContainer>
            <div className="flex flex-col divide-y divide-border/60">
              {data.map(item => (
                <button key={item.categoryId ?? item.name} type="button" disabled={!item.categoryId}
                  onClick={() => { if (item.categoryId) onCategoryFilter(item.categoryId); }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-1 py-2 text-left enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: item.fill }} />
                    <span className="break-words font-medium">{item.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums">
                    <span className="block">{money(item.value)}</span>
                    <span className="text-muted-foreground">{Math.round(item.value / total * 100)}%</span>
                  </span>
                </button>
              ))}
            </div>
            {report?.categories.some(category => category.spending_cents < 0) && (
              <p className="text-xs text-muted-foreground">Shares use categories with positive net spending. Refunds reduce the total above.</p>
            )}
            {report && report.total > report.categories.length && (
              <p className="text-xs text-muted-foreground">Shares cover this report page. See Detailed spending reports for all categories.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{report ? "No positive category spending for these dates." : "Loading category spending…"}</p>
        )}
        {report && report.unbudgeted_cents !== 0 && (
          <p className="text-xs text-muted-foreground">Unbudgeted spending · <span className="tabular-nums">{money(report.unbudgeted_cents)}</span></p>
        )}
      </CardContent>
    </Card>
  );
}
