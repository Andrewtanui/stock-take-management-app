// Brand line shown by both apps (loading screen, Hub menu, counter home, reports).
// KEEP IDENTICAL in both repos (src/shared/brand.ts) — `npm run check:shared`
// fails if they drift. Wording as given by NKG, 28 Oct 2026.

/** The slogan's two lines, as the loading screen sets them. */
export const SLOGAN_LINES = ["Locally Rooted", "Globally Connected."] as const;
export const SLOGAN = SLOGAN_LINES.join(" ");
