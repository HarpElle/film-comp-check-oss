import { COPY } from "@/lib/copy";
import { PRIVACY_FOOTER, SOURCE_LABEL, SOURCE_URL } from "@/lib/messages";

/** Landing: the limits sentence sits in the footer. Results: it is status line 2 (WP-F, D1), so the footer keeps privacy only. */
export function Footer({ limits }: { limits: boolean }) {
  return (
    <footer className="foot">
      {limits && <p className="small muted" data-testid="limits-footer">{COPY.limits}</p>}
      <p className="small muted" data-testid="privacy-footer">{PRIVACY_FOOTER}</p>
      <p className="small muted no-print" data-testid="source-footer"><a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{SOURCE_LABEL}</a></p>
    </footer>
  );
}
