/** Logos shipped in public/banks_logo. The stored value is the file name without ".png"; "" means no logo. */
export const ACCOUNT_LOGOS = [
  { id: "atome", label: "Atome" }, { id: "billease", label: "BillEase" }, { id: "BDO", label: "BDO" },
  { id: "bpi", label: "BPI" }, { id: "BPI_direct_banko", label: "BPI Direct BanKo" }, { id: "cimb", label: "CIMB" },
  { id: "eastwest", label: "EastWest" }, { id: "gcash", label: "GCash" }, { id: "gotyme", label: "GoTyme" },
  { id: "homecredit", label: "Home Credit" }, { id: "landbank", label: "Landbank" }, { id: "maribank", label: "MariBank" },
  { id: "maya", label: "Maya" }, { id: "metrobank", label: "Metrobank" }, { id: "pnb", label: "PNB" },
  { id: "rcbc", label: "RCBC" }, { id: "security_bank", label: "Security Bank" }, { id: "tonik", label: "Tonik" },
  { id: "union_bank", label: "UnionBank" }, { id: "uno", label: "UNO" }, { id: "wise", label: "Wise" },
] as const;

export type AccountLogoId = (typeof ACCOUNT_LOGOS)[number]["id"];
export const accountLogoIds = ACCOUNT_LOGOS.map(logo => logo.id) as [AccountLogoId, ...AccountLogoId[]];
export const accountLogoSrc = (id: string) => `/banks_logo/${id}.png`;
