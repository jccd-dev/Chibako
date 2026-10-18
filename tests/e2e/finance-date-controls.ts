import type { Page } from "@playwright/test";

async function openFinancePicker(page: Page, label: string) {
  const trigger = page.getByLabel(label, { exact: true });
  await trigger.click();
  const popupId = await trigger.getAttribute("aria-controls");
  if (!popupId) throw new Error(`Finance picker ${label} has no controlled popover`);
  return page.locator(`[id=${JSON.stringify(popupId)}]`);
}

export async function chooseFinanceDate(page: Page, label: string, date: string) {
  const popup = await openFinancePicker(page, label);
  const day = popup.locator(`[role="gridcell"][data-day="${date}"] button`);
  for (;;) {
    if (await day.count()) break;
    const dates = await popup.locator('[role="gridcell"][data-day]').evaluateAll(cells =>
      cells.map(cell => cell.getAttribute("data-day")).filter((value): value is string => value !== null),
    );
    const first = dates[0];
    const last = dates.at(-1);
    if (!first || !last || (date >= first && date <= last)) throw new Error(`Finance calendar did not render ${date}`);
    const direction = date < first ? "Go to the Previous Month" : "Go to the Next Month";
    await popup.getByRole("button", { name: direction, exact: true }).click();
  }
  await day.click();
}

export async function chooseFinanceMonth(page: Page, label: string, month: string) {
  const popup = await openFinancePicker(page, label);
  const [year, monthNumber] = month.split("-").map(Number);
  let currentYear = Number(await popup.locator("p").innerText());
  for (; currentYear < year; currentYear++) await popup.getByRole("button", { name: "Next year", exact: true }).click();
  for (; currentYear > year; currentYear--) await popup.getByRole("button", { name: "Previous year", exact: true }).click();
  await popup.getByRole("button", { name: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][monthNumber - 1], exact: true }).click();
}
