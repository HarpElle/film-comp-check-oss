/**
 * Two-way step/note links: following one opens the target's container if it is closed, moves
 * focus to the target and marks it (blue-50) until the next click anywhere.
 */
export const stepId = (n: number) => `step-${n}`;
export const noteId = (compKey: string) => `note-${compKey}`;

export function focusLinkTarget(id: string, tries = 10): void {
  const el = document.getElementById(id);
  if (!el || el.closest("[hidden]")) { if (tries > 0) requestAnimationFrame(() => focusLinkTarget(id, tries - 1)); return; }
  const fold = el.closest("details");
  if (fold && !fold.open) fold.open = true;
  document.querySelectorAll(".link-target").forEach((x) => x.classList.remove("link-target"));
  el.classList.add("link-target");
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
  el.scrollIntoView({ block: "center" });
  history.replaceState(null, "", `#${id}`);
  const clear = () => { el.classList.remove("link-target"); document.removeEventListener("pointerdown", clear, true); };
  setTimeout(() => document.addEventListener("pointerdown", clear, true), 0);
}
