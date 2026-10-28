/**
 * The user's own comps, kept in this browser only (localStorage). Nothing about a draft is sent anywhere:
 * the server sees comps only when "Check comps" runs. A sample deck is never saved as a draft, and loading a
 * sample never overwrites one (design spec: "Sample vs draft").
 */
export const DRAFT_KEY = "fcc:draft";
export const DRAFT_SAVED = "Draft saved in this browser.";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const local = (): Store | null => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };

export function loadDraft(store: Store | null = local()): string | null {
  try { const v = store?.getItem(DRAFT_KEY); return v && v.trim() ? v : null; } catch { return null; }
}

/** Saves `text` as the draft unless it is a sample deck. Empty text clears it. Returns whether a draft is now saved. */
export function saveDraft(text: string, isSample: (t: string) => boolean, store: Store | null = local()): boolean {
  if (!store) return false;
  try {
    if (!text.trim()) { store.removeItem(DRAFT_KEY); return false; }
    if (isSample(text)) return false;
    store.setItem(DRAFT_KEY, text);
    return true;
  } catch { return false; }
}
