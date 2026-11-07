import { MaintenanceError } from "../../lib/db";
import { processAutomaticInterest } from "./interest-processing";
import { processAutomaticSchedules } from "./recurrence";

const runner = globalThis as typeof globalThis & { financeAutomaticPlansTimer?: ReturnType<typeof setInterval> };

export function startAutomaticPlans(): void {
  if (runner.financeAutomaticPlansTimer) return;
  let lastFailure = false;
  let lastInterestFailure = false;
  const tick = () => {
    try {
      const result = processAutomaticSchedules();
      if (result.failed_count > 0 && !lastFailure) console.error("Automatic finance posting failed. Review schedule errors in Finance Planning.");
      lastFailure = result.failed_count > 0;
    } catch (error) {
      if (error instanceof MaintenanceError) return;
      if (!lastFailure) console.error(`Automatic finance processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      lastFailure = true;
    }
    try {
      const result = processAutomaticInterest();
      if (result.failed_count > 0 && !lastInterestFailure) console.error("Automatic interest failed. Review account interest errors in Finance.");
      lastInterestFailure = result.failed_count > 0;
    } catch (error) {
      if (error instanceof MaintenanceError) return;
      if (!lastInterestFailure && !lastFailure) console.error("Automatic interest processing failed. Review account interest settings and dated cash history.");
      lastInterestFailure = true;
    }
  };
  runner.financeAutomaticPlansTimer = setInterval(tick, 60_000);
  runner.financeAutomaticPlansTimer.unref();
  tick();
}
