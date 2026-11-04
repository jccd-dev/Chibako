import { AsyncLocalStorage } from "node:async_hooks";

// Next captures the AsyncLocalStorage global when it first loads, so set it before requiring Next modules.
Object.assign(globalThis, { AsyncLocalStorage });
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after the global above
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external") as typeof import("next/dist/server/app-render/work-async-storage.external");

/** Runs a withAuth route handler where cookies() works and is empty (forceStatic), as for a request without a session. */
export const inRequestScope = <T>(run: () => Promise<T>): Promise<T> =>
  workAsyncStorage.run({ forceStatic: true } as never, run);
