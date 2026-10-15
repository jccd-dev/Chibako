export interface ScheduleCalendar {
  start_date: string;
  end_date: string | null;
  interval_count: number;
  interval_unit: "day" | "week" | "month" | "year";
}

// Calculate from the anchor so February's clamp does not shift March's date.
export function occurrenceDate(schedule: ScheduleCalendar, index: number): string | null {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(schedule.interval_count) || schedule.interval_count < 1) return null;
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(schedule.start_date)) return null;
  const anchor = new Date(`${schedule.start_date}T00:00:00Z`);
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== schedule.start_date) return null;
  if (schedule.end_date !== null) {
    const end = new Date(`${schedule.end_date}T00:00:00Z`);
    if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(schedule.end_date) || !Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== schedule.end_date) return null;
  }
  const [year, month, day] = schedule.start_date.split("-").map(Number), steps = index * schedule.interval_count;
  if (!Number.isSafeInteger(steps)) return null;
  let date: Date;
  if (schedule.interval_unit === "day" || schedule.interval_unit === "week") {
    date = anchor;
    date.setUTCDate(date.getUTCDate() + steps * (schedule.interval_unit === "week" ? 7 : 1));
  } else if (schedule.interval_unit === "month" || schedule.interval_unit === "year") {
    const months = month - 1 + (schedule.interval_unit === "year" ? steps * 12 : steps);
    const targetYear = year + Math.floor(months / 12), targetMonth = months % 12;
    if (targetYear > 9999) return null;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  } else return null;
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  const result = date.toISOString().slice(0, 10);
  return schedule.end_date && result > schedule.end_date ? null : result;
}

export function nextOccurrenceDate(schedule: ScheduleCalendar, after: string): string | null {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(after)) return null;
  const date = new Date(`${after}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== after) return null;
  let low = 0, high = 4000000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2), next = occurrenceDate(schedule, mid);
    if (next === null || next > after) high = mid; else low = mid + 1;
  }
  return occurrenceDate(schedule, low);
}
