import { redirect } from "next/navigation";
import { isSetup, getSession, getCookieToken } from "@/lib/auth";
import { SetupForm } from "./SetupForm";

export default async function SetupPage() {
  if (isSetup() && getSession(await getCookieToken())) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-8 text-center">
          <img src="/logo_main.png" alt="Chibako logo" width={56} height={56} className="mx-auto mb-3 h-14 w-14" />
          <h1 className="text-xl font-semibold tracking-tight">Welcome to Chibako</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create your admin account to begin.</p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}