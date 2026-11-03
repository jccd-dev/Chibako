/** Shared by the server, hook briefing and local setup/status. */
export function memoryStaleDays(): number {
  const days = Number(process.env.CHIBAKO_MEMORY_STALE_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 7;
}
