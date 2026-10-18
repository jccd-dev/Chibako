"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getNewPasswordError, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/password-policy";

export function SetupForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const passwordError = getNewPasswordError(password);
    if (passwordError) return setError(passwordError);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, setupToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Setup failed.");
      setBusy(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="setup-token">Setup token</FieldLabel>
          <Input id="setup-token" type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" maxLength={1024} required />
          <p className="text-sm text-muted-foreground">Enter the token configured by the server owner.</p>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-password">Admin password</FieldLabel>
          <Input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 15 characters" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} autoComplete="new-password" autoFocus required />
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-confirm">Confirm password</FieldLabel>
          <Input id="setup-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" required />
        </Field>
      </FieldGroup>
      <Button className="w-full" disabled={busy} type="submit">
        {busy ? "Setting up…" : "Create account"}
      </Button>
    </form>
  );
}
