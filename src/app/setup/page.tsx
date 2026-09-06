import { redirect } from "next/navigation";
import { isSetup, getSession, getCookieToken } from "@/lib/auth";
import { SetupForm } from "./SetupForm";

export default async function SetupPage() {
  if (isSetup() && getSession(await getCookieToken())) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome to Chibako</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create your admin account to begin.</p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}