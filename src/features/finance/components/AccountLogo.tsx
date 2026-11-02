import Image from "next/image";
import { cn } from "cn";
import { accountLogoSrc } from "../account-logos";

/** Bank or wallet logo; falls back to the account's initial so rows stay aligned. */
export function AccountLogo({ logo, name, className }: { logo: string; name: string; className?: string }) {
  const box = cn("size-8 shrink-0 rounded-md", className);
  return logo
    ? <Image src={accountLogoSrc(logo)} alt="" width={56} height={57} unoptimized className={cn(box, "object-contain")} />
    : <span aria-hidden="true" className={cn(box, "grid place-items-center bg-muted text-xs font-medium text-muted-foreground")}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}
