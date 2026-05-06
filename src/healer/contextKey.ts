/** djb2-style hash — same algorithm used by SelectorHealer for SPA page-state fingerprints. */
export function contextHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).slice(0, 8);
}

/**
 * Derives a short context key from a page's title and first two headings.
 * Different SPA states that share a URL but show different content produce
 * different keys, preventing cross-state cache contamination.
 *
 * Returns "" when there is not enough signal (no title and no headings).
 */
export function pageContextKey(title: string, headings: string[]): string {
  const raw = [title, headings.slice(0, 2).filter(Boolean).join("|")]
    .filter(Boolean)
    .join("|");
  return raw ? contextHash(raw) : "";
}
