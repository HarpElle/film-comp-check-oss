import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * WP-A header. Landing: the logo and wordmark only. Results: the deck chip, "Edit comps" (toggles the deck box)
 * and whatever goes after it (the Export menu).
 */
export function AppHeader({ results, children }: { results?: { chip: string; editing: boolean; onEdit: () => void }; children?: ReactNode }) {
  return (
    <header className="appbar" data-testid="appbar">
      <a className="brand" href="/"><img src="/brand/logo-mark.svg" alt="" /><span className="wordmark">Film Comp Check</span></a>
      {results && (
        <>
          <span className="deckchip" data-testid="deckchip">{results.chip}</span>
          <span className="spacer" />
          <div className="actions">
            <button className="btn sm" aria-expanded={results.editing} aria-label="Edit comps" onClick={results.onEdit}><Icon name="pencil" /><span className="lbl">Edit comps</span></button>
            {children}
          </div>
        </>
      )}
    </header>
  );
}
