import { redirect } from "next/navigation";
import { isSetup } from "@/server/auth/password-authentication";
import { getSession, getCookieToken } from "@/lib/auth";

export default async function Home() {
  const authed = getSession(await getCookieToken());
  if (!isSetup()) redirect("/setup");
  if (authed) redirect("/app");
  redirect("/login");
}