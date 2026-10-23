import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { FinanceAttentionQueue } from "../../src/features/finance/components/FinanceAttentionQueue";
import type { FinanceAttentionPage } from "../../src/features/finance/overview-types";

test("attention queue stops at its bounded final page and identifies remaining items", () => {
  const page: FinanceAttentionPage = {
    items: Array.from({ length: 50 }, (_, index) => ({
      id: `plan:${index}`,
      kind: "pending_plan",
      reference_id: String(index),
      title: "Expense plan",
      target: "planning",
      urgency: "upcoming",
      due_date: "2026-10-20",
      amount_cents: 100,
      currency: "PHP",
    })),
    total: 1100,
    limit: 50,
    offset: 1000,
    as_of: "2026-10-10",
    through_date: "2026-11-09",
    currency: "PHP",
  };
  const attention = {
    page,
    loading: false,
    error: "",
    offset: page.offset,
    setOffset: () => undefined,
    refresh: async () => undefined,
  };
  const html = renderToStaticMarkup(createElement(FinanceAttentionQueue, { attention, onReview: () => undefined }));
  const previous = html.match(/<button\b[^>]*>Previous<\/button>/)?.[0];
  const next = html.match(/<button\b[^>]*>Next<\/button>/)?.[0];

  assert.ok(previous);
  assert.ok(next);
  assert.doesNotMatch(previous, /\sdisabled(?:=""|\s|>)/);
  assert.match(next, /\sdisabled(?:=""|\s|>)/);
  assert.match(html, /first 1,050 items/i);
});
