import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page) {
  await page.route("**/api/login", route => route.continue({
    headers: { ...route.request().headers(), "x-chibako-client-ip": `orbs-${Date.now()}-${Math.random()}` },
  }));
  await page.goto("/app/note/new");
  if (/\/(setup|login)$/.test(page.url())) {
    const setup = /\/setup$/.test(page.url());
    await page.locator(setup ? "#setup-password" : "#login-password").fill("correct horse battery staple");
    if (setup) {
      await page.locator("#setup-token").fill(process.env.CHIBAKO_SETUP_TOKEN ?? "");
      await page.locator("#setup-confirm").fill("correct horse battery staple");
    }
    await page.getByRole("button", { name: setup ? "Create account" : "Sign in" }).click();
  }
  await expect(page).toHaveURL(/\/app(?:\/note\/[^/]+)?$/);
}

async function pauseRequest(page: Page, url: string, method = "GET") {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let failure: string | undefined;
  await page.route(url, async route => {
    if (route.request().method() !== method) return route.continue();
    await gate;
    if (failure) await route.fulfill({ status: 503, json: { error: failure } });
    else await route.continue();
  });
  return (error?: string) => { failure = error; release(); };
}

test("search failures replace the orb with an error, rather than no matches", async ({ page }) => {
  await authenticate(page);
  const release = await pauseRequest(page, "**/api/search?**");
  try {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Command palette" }).fill("orb-search-fixture");
    const loading = page.getByRole("status").filter({ hasText: "Searching notes…" });
    await expect(loading.locator("svg")).toBeVisible();
    release("Search unavailable");
    await expect(page.getByRole("alert").filter({ hasText: "Could not search notes" })).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page.locator("#command-results")).not.toContainText("No notes match");
  } finally { release(); }
});

test("settings loading and failed saves release their orbs without changing saved data", async ({ page }) => {
  await authenticate(page);
  const before = await page.request.get("/api/schema");
  const original = await before.json();
  const releaseLoad = await pauseRequest(page, "**/api/schema");
  try {
    await page.goto("/app/settings");
    const loading = page.getByRole("status").filter({ hasText: "Loading settings…" });
    await expect(loading.locator("svg")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save schema", exact: true })).toBeDisabled();
    releaseLoad();
    await expect(loading).toHaveCount(0);
    await page.unroute("**/api/schema");
    const releaseSave = await pauseRequest(page, "**/api/schema", "PUT");
    try {
      const save = page.getByRole("button", { name: "Save schema", exact: true });
      await save.click();
      await expect(save).toHaveAttribute("aria-busy", "true");
      await expect(save.locator("svg")).toHaveCSS("width", "16px");
      releaseSave("Save unavailable");
      await expect(page.getByText("Could not save schema. Try again.")).toBeVisible();
      await expect(save).toBeEnabled();
      await expect(save.locator("svg")).toHaveCount(0);
      expect(await (await page.request.get("/api/schema")).json()).toEqual(original);
    } finally { releaseSave(); }
  } finally { releaseLoad(); }
});

test("graph failure replaces its panel orb with an error", async ({ page }) => {
  await authenticate(page);
  const release = await pauseRequest(page, "**/api/graph");
  try {
    await page.goto("/app/graph");
    const loading = page.getByRole("status").filter({ hasText: "Loading graph…" });
    await expect(loading.locator("svg")).toHaveCSS("width", "96px");
    await expect(page.getByText("No notes yet — create a note to start the graph.")).toHaveCount(0);
    release("Graph unavailable");
    await expect(page.getByRole("alert").filter({ hasText: "Could not load the graph" })).toBeVisible();
    await expect(loading).toHaveCount(0);
  } finally { release(); }
});

test("task drawer shows a panel orb until its lookups arrive", async ({ page }) => {
  await authenticate(page);
  await page.goto("/app/tasks");
  const release = await pauseRequest(page, "**/api/properties");
  try {
    await page.getByRole("button", { name: "New task" }).click();
    const drawer = page.getByRole("dialog");
    const loading = drawer.getByRole("status").filter({ hasText: "Loading task…" });
    await expect(loading.locator("svg")).toHaveCSS("width", "96px");
    release();
    await expect(drawer.getByLabel("Task title")).toBeVisible();
    await expect(loading).toHaveCount(0);
  } finally { release(); }
});

test("note navigation shows progress while retaining the current editor", async ({ page }) => {
  await authenticate(page);
  await page.evaluate(() => localStorage.setItem("chibako_view", "edit"));
  const notes: { id: string; title: string; content: string }[] = [];
  for (const label of ["first", "second"]) {
    const response = await page.request.post("/api/notes", { data: { title: `Orb navigation ${label} ${Date.now()}`, content: `${label} document` } });
    expect(response.ok()).toBe(true);
    notes.push((await response.json()).note);
  }
  const [first, second] = notes;
  await page.goto(`/app/note/${first.id}`);
  const editor = page.getByRole("textbox", { name: "Note content" });
  await expect(editor).toHaveValue(first.content);
  const release = await pauseRequest(page, `**/app/note/${second.id}**`);
  try {
    await page.getByRole("navigation", { name: "Files and folders" }).getByRole("link", { name: second.title, exact: true }).click();
    const loading = page.getByRole("status").filter({ hasText: "Opening note…" });
    await expect(loading.locator("svg")).toBeVisible();
    await expect(editor).toHaveValue(first.content);
    release();
    await expect(editor).toHaveValue(second.content);
    await expect(loading).toHaveCount(0);
  } finally { release(); }
});

test("import and file filtering show activity until their requests finish", async ({ page }) => {
  await authenticate(page);
  await page.goto("/app/note");
  const title = `Orb import fixture ${Date.now()}`;
  const releaseImport = await pauseRequest(page, "**/api/notes", "POST");
  try {
    await page.locator('input[accept=".md,.markdown,text/markdown"]').setInputFiles({
      name: `${title}.md`, mimeType: "text/markdown", buffer: Buffer.from("Orb import fixture body"),
    });
    const loading = page.getByRole("status").filter({ hasText: "Working on files…" });
    await expect(loading.locator("svg")).toBeVisible();
    releaseImport();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(title);
    await expect(loading).toHaveCount(0);
    const releaseFilter = await pauseRequest(page, "**/api/search?**");
    try {
      await page.getByRole("textbox", { name: "Filter files" }).fill(title);
      const searching = page.getByRole("status").filter({ hasText: "Searching files…" });
      await expect(searching.locator("svg")).toBeVisible();
      releaseFilter();
      await expect(searching).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Files and folders" }).getByRole("link", { name: title, exact: true })).toBeVisible();
    } finally { releaseFilter(); }
  } finally { releaseImport(); }
});

test("failed deletion releases the confirmation button and preserves the note", async ({ page }) => {
  await authenticate(page);
  const response = await page.request.post("/api/notes", { data: { title: `Orb delete fixture ${Date.now()}`, content: "must survive" } });
  expect(response.ok()).toBe(true);
  const note: { id: string; title: string } = (await response.json()).note;
  await page.goto(`/app/note/${note.id}`);
  const release = await pauseRequest(page, `**/api/notes/${note.id}`, "DELETE");
  try {
    await page.getByRole("navigation", { name: "Files and folders" }).getByRole("button", { name: `Actions for ${note.title}` }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
    await confirm.click();
    await expect(confirm.locator("svg")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    release("Fixture deletion refused");
    await expect(page.getByText("Fixture deletion refused")).toBeVisible();
    await expect(confirm).toBeEnabled();
    await expect(confirm.locator("svg")).toHaveCount(0);
    expect((await page.request.get(`/api/notes/${note.id}`)).ok()).toBe(true);
  } finally { release(); }
});

test("sign-in connection failures release the button orb", async ({ page, context }) => {
  await authenticate(page);
  await context.clearCookies();
  await page.goto("/login");
  const release = await pauseRequest(page, "**/api/login", "POST");
  try {
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const signingIn = page.getByRole("button", { name: "Signing in…" });
    await expect(signingIn.locator("svg")).toBeVisible();
    release("Sign-in unavailable");
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in unavailable" })).toBeVisible();
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(signIn).toBeEnabled();
    await expect(signIn.locator("svg")).toHaveCount(0);
    await expect(page).toHaveURL("/login");
  } finally { release(); }
});

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`panel orb follows ${theme} theme at ${width}px and respects reduced motion`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(value => localStorage.setItem("chibako_theme", value), theme);
      await authenticate(page);
      const release = await pauseRequest(page, "**/api/graph");
      try {
        await page.goto("/app/graph");
        const loading = page.getByRole("status").filter({ hasText: "Loading graph…" });
        const orb = loading.locator("svg");
        await expect(orb).toBeVisible();
        await expect.poll(() => orb.locator("*").count()).toBeGreaterThan(0);
        const brand = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--brand)";
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        });
        await expect(orb).toHaveCSS("color", brand);
        await expect(orb).toHaveAttribute("aria-hidden", "true");
        const stillFrame = await orb.innerHTML();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await orb.innerHTML()).toBe(stillFrame);
        const bounds = await orb.boundingBox();
        expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`orb-${theme}-${width}.png`) });
        release();
        await expect(loading).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally { release(); }
    });
  }
}
