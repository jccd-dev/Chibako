import assert from "node:assert/strict";
import test from "node:test";
import { flowPoints } from "../../src/features/finance/components/FinanceOverviewDashboard";

function days(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const day = from + i;
    return { date: `2026-11-${String(day).padStart(2, "0")}`, income_cents: day === 1 ? 4500 : 0, spending_cents: day === 10 ? 100 : 0 };
  });
}

test("month view folds days into the calendar's Sunday-start week rows with running totals that stop at today", () => {
  // November 2026 starts on a Sunday: 1–7, 8–14, 15–21, 22–28, 29–30.
  const points = flowPoints("month", days(1, 30), "2026-11-15");
  assert.deepEqual(points.map((p) => p.tick), ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]);
  assert.deepEqual(points.map((p) => [p.income, p.expenses]), [[4500, 0], [4500, 100], [4500, 100], [null, null], [null, null]]);
  assert.equal(points[1].label, "Nov 8 – Nov 14, 2026");
});

test("week view keeps one point per day", () => {
  assert.equal(flowPoints("week", days(15, 21), "2026-11-15").length, 7);
});
