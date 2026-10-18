"use client";

import { Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
        <CardTitle>Expenses</CardTitle>
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
            <div className="flex flex-wrap gap-1.5" aria-label="Category spending breakdown">
              {data.map(item => {
                const share = total > 0 ? `${Math.round(item.value / total * 100)}%` : "";
                const title = item.categoryId ? `${item.name}: ${money(item.value)} (${share})` : item.name;
                if (!item.categoryId) {
                  return (
                    <Badge key={item.name} variant="outline" className="max-w-full" title={title}>
                      <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: item.fill }} aria-hidden="true" />
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{share}</span>
                    </Badge>
                  );
                }
                return (
                  <Badge
                    key={item.categoryId}
                    variant="secondary"
                    className="max-w-full"
                    title={title}
                    render={<button type="button" className="enabled:cursor-pointer" onClick={() => onCategoryFilter(item.categoryId!)} />}
                  >
                    <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: item.fill }} aria-hidden="true" />
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{share}</span>
                  </Badge>
                );
              })}
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
