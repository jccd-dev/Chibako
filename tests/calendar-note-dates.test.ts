import assert from "node:assert/strict";
import { test } from "node:test";
import { rescheduleRange } from "../src/features/calendar/note-dates";

const trip = { date: "2026-03-30", endDate: "2026-04-02" };
const day = { date: "2026-05-12", endDate: "2026-05-12" };

test("moving a range keeps its length across a month boundary", () => {
  assert.deepEqual(rescheduleRange(trip, "move", "2026-03-31", "2026-04-03"), { date: "2026-04-02", end_date: "2026-04-05" });
  assert.deepEqual(rescheduleRange(day, "move", "2026-05-12", "2026-05-01"), { date: "2026-05-01", end_date: null });
});

test("resizing an edge sets that date and clamps at the opposite edge", () => {
  assert.deepEqual(rescheduleRange(trip, "start", "2026-03-30", "2026-03-28"), { date: "2026-03-28", end_date: "2026-04-02" });
  assert.deepEqual(rescheduleRange(trip, "end", "2026-04-02", "2026-04-09"), { date: "2026-03-30", end_date: "2026-04-09" });
  assert.deepEqual(rescheduleRange(trip, "start", "2026-03-30", "2026-04-20"), { date: "2026-04-02", end_date: null });
  assert.deepEqual(rescheduleRange(trip, "end", "2026-04-02", "2026-03-01"), { date: "2026-03-30", end_date: null });
});

test("a single day gains end_date when resized and loses it when shrunk back", () => {
  assert.deepEqual(rescheduleRange(day, "end", "2026-05-12", "2026-05-14"), { date: "2026-05-12", end_date: "2026-05-14" });
  assert.deepEqual(rescheduleRange(day, "start", "2026-05-12", "2026-05-10"), { date: "2026-05-10", end_date: "2026-05-12" });
  assert.deepEqual(rescheduleRange({ date: "2026-05-12", endDate: "2026-05-14" }, "end", "2026-05-14", "2026-05-12"), { date: "2026-05-12", end_date: null });
});
