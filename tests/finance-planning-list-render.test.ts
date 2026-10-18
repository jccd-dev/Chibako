import { PlanPanel } from "../src/features/finance/components/FinancePlans";
import type { FinancePlan } from "../src/features/finance/planning-types";
import { FinanceSchedulePaymentRow } from "../src/features/finance/components/FinanceSchedulePayments";
import { useFinancePlanEntry } from "../src/features/finance/use-finance-plan-entry";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { FinancePlanningList } from "../src/features/finance/components/FinancePlanningList";
import type { FinancePlanningListController } from "../src/features/finance/use-finance-planning-list";
import type { PlanningItem } from "../src/features/finance/planning-list-types";
import { FinancePlanningForm } from "../src/features/finance/components/FinancePlanningForm";
import { useFinanceActivity } from "../src/features/finance/use-finance-activity";
import { useFinancePlanning } from "../src/features/finance/use-finance-planning";
import { useFinanceRecurrence } from "../src/features/finance/use-finance-recurrence";
import { FinancePlanCategories } from "../src/features/finance/components/FinancePlanCategories";

const item: PlanningItem = {
  kind: "schedule", id: "subscription", title: "TEST subscription", type: "expense", amount_cents: 112200,
  account_name: "TEST account", handling: "manual", interval_count: 1, interval_unit: "month", paused: false,
  next_due_date: "2026-10-01", pending_count: 4, overdue_count: 3, due_today_count: 0, manual_due_count: 3,
  first_pending_id: "payment-one", automatic_error: null, status: "overdue",
};
const list: FinancePlanningListController = {
  filter: "all", changeFilter: () => undefined, offset: 0, setOffset: () => undefined,
  page: { items: [item, { ...item, kind: "one-time", id: "once", title: "TEST one-time", interval_count: null, interval_unit: null, status: "recorded", next_due_date: null, pending_count: 0, overdue_count: 0, manual_due_count: 0 }], total: 2, limit: 25, offset: 0 },
  error: undefined, loading: false, refresh: () => undefined,
};

test("one Plans list shows each schedule once with overdue counts, one-offs and contextual review", () => {
  const html = renderToStaticMarkup(createElement(FinancePlanningList, { list, busy: false, onAdd: () => undefined, onOpen: () => undefined }));
  assert.match(html, /aria-label="Plans"/);
  assert.equal((html.match(/>TEST subscription</g) ?? []).length, 1);
  assert.match(html, /3 payments overdue/);
  assert.match(html, /Review 3 due payments/);
  assert.match(html, /One-time/);
  assert.match(html, /Recorded/);
  assert.match(html, /Needs attention/);
  assert.doesNotMatch(html, /Planned activity and occurrences|Schedule status|Plan status|Refresh due occurrences/);
});

test("a filtered empty state lets people find other plans without showing a duplicate queue", () => {
  const html = renderToStaticMarkup(createElement(FinancePlanningList, { list: { ...list, filter: "attention", page: { items: [], total: 0, limit: 25, offset: 0 } }, busy: false, onAdd: () => undefined, onOpen: () => undefined }));
  assert.match(html, /No matching plans/);
  assert.match(html, /Choose another filter/);
  assert.doesNotMatch(html, /No pending plans/);
});

function CreationForm() {
  const activity = useFinanceActivity(async () => undefined);
  const planning = useFinancePlanning("", async () => undefined);
  const recurrence = useFinanceRecurrence(planning);
  return createElement(FinancePlanningForm, {
    activity, planning, recurrence, schedule: null, occurrence: null, initialRecurring: true,
    reminders: { obligations: [], loading: false, error: "", reload: () => undefined, hasMore: false, loadMore: () => undefined },
    onClose: () => undefined, onRefresh: () => undefined, onBusyChange: () => undefined,
  });
}

test("new plan form starts recurring, monthly and manual while keeping the one-time toggle", () => {
  const html = renderToStaticMarkup(createElement(CreationForm));
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /aria-pressed="true"[^>]*>Monthly</);
  assert.match(html, /aria-pressed="true"[^>]*>Manual mark</);
  assert.match(html, /Set as recurring expense/);
  assert.doesNotMatch(html, /Auto deduct<[^]*aria-checked="true"/);
});

function UncategorizedCategoryPicker() {
  const activity = useFinanceActivity(async () => undefined);
  return createElement(FinancePlanCategories, { activity, type: "expense", value: "", onChange: () => undefined, disabled: false, id: "test-category" });
}

test("uncategorized remains the selected category when no classifications exist", () => {
  const html = renderToStaticMarkup(createElement(UncategorizedCategoryPicker));
  assert.match(html, /<button(?=[^>]*aria-pressed="true")[^>]*>Uncategorized<\/button>/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});


const payment: FinancePlan = {
  id: "TEST payment", type: "expense", account_id: "TEST account", account_name: "TEST account", currency: "PHP", amount_cents: 1000,
  due_date: "2027-01-15", category_id: null, subcategory_id: null, category_name: null, obligation_id: null,
  logged_time: "00:00", timezone: "UTC", handling: "manual", schedule_id: "TEST schedule", occurrence_date: "2027-01-15",
  status: "pending", transaction_id: null, version: 1,
};

function PaymentEntry({ plan }: { plan: FinancePlan }) {
  const activity = useFinanceActivity(async () => undefined);
  const planning = useFinancePlanning("", async () => undefined);
  const entry = useFinancePlanEntry(plan, activity, planning, null, () => undefined);
  return createElement("span", null, entry.mode);
}

test("upcoming manual and automatic payments expose logging and open confirmation directly", () => {
  for (const handling of ["manual", "automatic"] as const) {
    const plan = { ...payment, handling };
    const html = renderToStaticMarkup(createElement(FinanceSchedulePaymentRow, { plan, today: "2026-10-15", busy: false, onReview: () => undefined }));
    assert.match(html, /Upcoming/);
    assert.match(html, /aria-label="Confirm payment due January 15, 2027"/);
    assert.match(html, />Confirm</);
    assert.equal(renderToStaticMarkup(createElement(PaymentEntry, { plan })), "<span>post</span>");
  }
  const html = renderToStaticMarkup(createElement(FinanceSchedulePaymentRow, { plan: { ...payment, type: "income" }, today: "2026-10-15", busy: false, onReview: () => undefined }));
  assert.match(html, />Confirm income</);
});

test("recorded and skipped payments have no logging action", () => {
  for (const status of ["satisfied", "cancelled"] as const) {
    const plan = { ...payment, status };
    const html = renderToStaticMarkup(createElement(FinanceSchedulePaymentRow, { plan, today: "2026-10-15", busy: false, onReview: () => undefined }));
    assert.doesNotMatch(html, />Confirm(?: income)?</);
    assert.equal(renderToStaticMarkup(createElement(PaymentEntry, { plan })), "<span>edit</span>");
  }
});


function InlinePayment({ plan, inline = true }: { plan: FinancePlan; inline?: boolean }) {
  const activity = useFinanceActivity(async () => undefined);
  const planning = useFinancePlanning("", async () => undefined);
  return createElement(PlanPanel, {
    plan, activity, planning, inline,
    reminders: { obligations: [], loading: false, error: "", reload: () => undefined, hasMore: false, loadMore: () => undefined },
    onClose: () => undefined, onFuture: () => undefined, onRefresh: () => undefined,
  });
}

test("inline logging renders the existing confirmation form without a second drawer or extra plan actions", () => {
  for (const handling of ["manual", "automatic"] as const) {
    const html = renderToStaticMarkup(createElement(InlinePayment, { plan: { ...payment, handling } }));
    assert.match(html, /Amount \(PHP\)/);
    assert.match(html, /Date paid/);
    assert.match(html, /Confirm payment/);
    assert.match(html, />Cancel</);
    assert.doesNotMatch(html, /role="dialog"|Close plan|More options|Edit (?:this )?occurrence|aria-label="Plan summary"|Match existing activity<\/button>/);
    const standalone = renderToStaticMarkup(createElement(InlinePayment, { plan: { ...payment, handling }, inline: false }));
    assert.match(standalone, />Match activity</);
  }
});
