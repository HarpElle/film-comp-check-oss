import type { RefObject } from "react";
import { toCsv, toMarkdown } from "@/lib/export";
import type { CheckResult } from "@/lib/types";
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

/** WP-J Export menu (plus "Copy share link"). Escape closes it and returns focus to its button. */
export function ExportMenu({ result, busy, menuRef, onCopyLink, copied }: { result: CheckResult | null; busy: boolean; menuRef: RefObject<HTMLDetailsElement | null>; onCopyLink: () => void; copied: string | null }) {
  return (
    <details className="menu" data-testid="export-menu" ref={menuRef} onKeyDown={(e) => { if (e.key === "Escape" && menuRef.current?.open) { menuRef.current.open = false; menuRef.current.querySelector("summary")?.focus(); } }}>
      <summary className="btn" aria-disabled={!result || busy}><Icon name="download" />Export<Icon name="chevronDown" /></summary>
      <div className="menu-list" role="menu" aria-label="Export">
        <button role="menuitem" disabled={!result || busy} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; window.print(); }}><Icon name="printer" /> Export sheet (print)</button>
        <button role="menuitem" disabled={!result || busy} onClick={() => result && download("comp-check.md", toMarkdown(result), "text/markdown")}>Export Markdown</button>
        <button role="menuitem" disabled={!result || busy} onClick={() => result && download("comp-check.csv", toCsv(result), "text/csv")}>Export CSV</button>
        <button role="menuitem" disabled={!result || busy} data-testid="copy-link" onClick={onCopyLink}><Icon name="link" /> Copy share link</button>
        <p className="small muted copy-note" role="status" data-testid="copied">{copied}</p>
      </div>
    </details>
  );
}
