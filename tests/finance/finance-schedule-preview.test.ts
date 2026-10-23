import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { FinanceSchedulePreview } from "../../src/features/finance/components/FinanceSchedulePreview";

type PreviewProps = ComponentProps<typeof FinanceSchedulePreview>;
function preview(overrides: Partial<PreviewProps["form"]> = {}, schedule: PreviewProps["schedule"] = null, occurrence: PreviewProps["occurrence"] = null) {
  const form: PreviewProps["form"] = {
    recurring: true, start: "2026-01-31", loggedDate: "2026-01-31", count: "1", unit: "month",
    endCondition: "forever", end: "", amount: "100", total: "", payments: "12", type: "expense",
    time: "09:00", timezone: "Asia/Manila", handling: "manual", ...overrides,
  };
  return renderToStaticMarkup(createElement(FinanceSchedulePreview, { form, schedule, occurrence }));
}

test("schedule preview uses the same month-end anchor as execution, including unchanged future edits", () => {
  assert.match(preview(), /February 28, 2026/);
  const html = preview({ start: "2026-02-28" }, { start_date: "2026-01-31", interval_count: 1, interval_unit: "month" }, { occurrence_date: "2026-02-28" });
  assert.match(html, /March 31, 2026/);
  assert.doesNotMatch(html, /March 28, 2026/);
});

test("date, payment and total boundaries do not promise an occurrence beyond the draft limit", () => {
  for (const fields of [
    { endCondition: "date", end: "2026-01-31" },
    { endCondition: "payments", payments: "1" },
    { endCondition: "total", total: "150" },
  ] satisfies Partial<PreviewProps["form"]>[]) {
    assert.match(preview(fields), /No further occurrence/);
    assert.doesNotMatch(preview(fields), /February 28/);
  }
  assert.match(preview({ endCondition: "total", total: "50" }), /Choose a valid date/);
  assert.match(preview({ start: "2026-02-30" }), /Choose a valid date/);
});

test("one-time, automatic income and capped edits describe their actual handling", () => {
  const once = preview({ recurring: false });
  assert.match(once, /stays pending until you confirm/);
  assert.doesNotMatch(once, /The next one follows/);
  assert.match(preview({ recurring: false, endCondition: "payments", payments: "0", count: "0" }), /stays pending until you confirm/);
  assert.match(preview({ recurring: false, loggedDate: "2026-02-30" }), /Choose a valid date/);
  const automatic = preview({ type: "income", handling: "automatic" });
  assert.match(automatic, /recurring income/);
  assert.match(automatic, /09:00 \(Asia\/Manila\)/);
  const capped = preview({ endCondition: "payments", payments: "2" }, { start_date: "2026-01-31", interval_count: 1, interval_unit: "month" });
  assert.match(capped, /lifetime limit and retained history/);
  assert.doesNotMatch(capped, /The next one follows/);
});
