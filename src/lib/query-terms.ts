// Pure query-term rules shared by Recall and the memory hooks, so both count the same terms. No imports on purpose.

/** Leading and trailing punctuation only, so `osprey?` becomes `osprey` while `i18n` and `a11y` stay whole. */
export const stripEdgePunctuation = (term: string) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Lowercase query terms without edge punctuation, for matching text. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).map(stripEdgePunctuation).filter(Boolean))];
}

// Filler words stop matching in Recall only; exact Search keeps every term.
// shortcut: short hand-picked English list plus common Tagalog, tune from recall misses.
const FILLER = new Set((
  "a an and are as at be been but by can could did do does for from had has have how i if in is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your " +
  "ang ay ba din na ng sa mga si ni kay ko mo ka ako ikaw siya kami tayo sila ito iyan iyon at o pero kasi para pa naman lang po ano paano bakit saan kailan sino"
).split(" "));

/** Drops filler terms for the keyword query; when nothing is left, the original terms stay. */
export function cleanQuery(query: string): string {
  const terms = query.split(/\s+/).filter(Boolean);
  const kept = terms.filter((t) => !FILLER.has(stripEdgePunctuation(t).toLowerCase()));
  return (kept.length ? kept : terms).join(" ");
}

/** The terms Recall actually searches for: filler dropped, lowercased, edge punctuation stripped, unique. */
export const effectiveTerms = (query: string): string[] => queryTerms(cleanQuery(query));
