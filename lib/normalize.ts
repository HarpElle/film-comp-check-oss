/** Title normalization shared by matching and tests. */
export function toAscii(s: string): string {
  return s
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
}

export function normalizeTitle(s: string): string {
  let t = toAscii(s).toLowerCase();
  t = t.replace(/'/g, "");
  t = t.replace(/&/g, " and ");
  t = t.replace(/[^a-z0-9 ]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^(the|a) /, "");
  return t;
}

/** Loose text normalization for "is this name present in the record". */
export function normalizeText(s: string): string {
  return toAscii(s).toLowerCase().replace(/'/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True if every token of the director name the user gave appears as a phrase in the record text. */
export function directorNamedIn(recordText: string, director: string): boolean {
  const hay = " " + normalizeText(recordText) + " ";
  const name = normalizeText(director);
  if (!name) return true;
  if (hay.includes(" " + name + " ")) return true;
  // Fall back to surname only (last token), e.g. "Quill" for "the Quill brothers".
  const parts = name.split(" ");
  const last = parts[parts.length - 1];
  return last.length >= 2 && hay.includes(" " + last + " ");
}
