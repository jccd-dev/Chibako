import { processAutomaticSchedules } from "./recurrence";

const runner = globalThis as typeof globalThis & { financeAutomaticPlansTimer?: ReturnType<typeof setInterval> };

export function startAutomaticPlans(): void {
  if (runner.financeAutomaticPlansTimer) return;
  let lastFailure = false;
  const tick = () => {
    try {
      const result = processAutomaticSchedules();
      if (result.failed_count > 0 && !lastFailure) console.error("Automatic finance posting failed. Review schedule errors in Finance Planning.");
      lastFailure = result.failed_count > 0;
    } catch {
      if (!lastFailure) console.error("Automatic finance processing failed. Check database access and restart the server.");
      lastFailure = true;
    }
  };
  runner.financeAutomaticPlansTimer = setInterval(tick, 60_000);
  runner.financeAutomaticPlansTimer.unref();
  tick();
}
