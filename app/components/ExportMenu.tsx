import { useState, type RefObject } from "react";
import { toCsv, toMarkdown } from "@/lib/export";
import type { CheckResult } from "@/lib/types";
import { EXPORT } from "@/lib/copy";
import { Icon } from "./Icon";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Moves focus among the enabled menu items (APG menu button: arrows wrap, Home/End jump). */
function moveFocus(menu: HTMLElement, to: "next" | "prev" | "first" | "last") {
  const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const j = to === "first" ? 0 : to === "last" ? items.length - 1 : to === "next" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[j].focus();
}

/**
 * WP-J Export menu (plus "Copy share link"). UX audit WP-10 (8.2): opening it focuses the first item; ArrowDown/Up move
 * (wrapping), Home/End jump, Escape closes and returns focus to its button, Tab closes.
 */
export function ExportMenu({ result, busy, menuRef, onCopyLink, copied, sampleId }: { result: CheckResult | null; busy: boolean; menuRef: RefObject<HTMLDetailsElement | null>; onCopyLink: () => void; copied: string | null; sampleId?: string }) {
  const [open, setOpen] = useState(false);
  const close = (refocus: boolean) => { const d = menuRef.current; if (!d?.open) return; d.open = false; if (refocus) d.querySelector("summary")?.focus(); };
  return (
    <details className="menu" data-testid="export-menu" ref={menuRef}
      onToggle={(e) => { const d = e.currentTarget; setOpen(d.open); if (d.open) requestAnimationFrame(() => moveFocus(d, "first")); }}
      onKeyDown={(e) => {
        const d = menuRef.current; if (!d?.open) return;
        const m = d.querySelector<HTMLElement>("[role=menu]")!;
        if (e.key === "Escape") { e.preventDefault(); close(true); }
        else if (e.key === "Tab") close(false);
        else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(m, "next"); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(m, "prev"); }
        else if (e.key === "Home") { e.preventDefault(); moveFocus(m, "first"); }
        else if (e.key === "End") { e.preventDefault(); moveFocus(m, "last"); }
      }}>
      <summary className="btn" aria-disabled={!result || busy} aria-haspopup="menu" aria-expanded={open}><Icon name="download" />Export<Icon name="chevronDown" /></summary>
      <div className="menu-list">
        <div role="menu" aria-label="Export">
          <button role="menuitem" disabled={!result || busy} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; window.print(); }}><Icon name="printer" /> {EXPORT.print}</button>
          <button role="menuitem" disabled={!result || busy} onClick={() => result && download(EXPORT.file(sampleId, "md"), toMarkdown(result), "text/markdown")}><Icon name="fileText" /> {EXPORT.markdown}</button>
          <button role="menuitem" disabled={!result || busy} onClick={() => result && download(EXPORT.file(sampleId, "csv"), toCsv(result), "text/csv")}><Icon name="download" /> {EXPORT.csv}</button>
          <button role="menuitem" disabled={!result || busy} data-testid="copy-link" onClick={onCopyLink}><Icon name="link" /> {EXPORT.link}</button>
        </div>
        <p className="small muted copy-note" role="status" data-testid="copied">{copied}</p>
      </div>
    </details>
  );
}
