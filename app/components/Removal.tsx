import { Icon } from "./Icon";

/** The collapsed row a removed comp leaves while the deck is rechecked, and after it (with Undo) until Undo or a new run. */
export function RemovedRow({ title, cols, order, onUndo }: { title: string; cols: number; order: number; onUndo?: () => void }) {
  return (
    <tr className="comp removed" data-testid="removed-row" data-title={title} style={{ ["--o" as string]: order }}>
      <td colSpan={cols}><s className="film">{title}</s> <span className="removed-tag">Removed</span>
        {onUndo && <span className="no-print">{" \u00b7 "}<button className="btn link" data-testid="removed-row-undo" onClick={onUndo}>Undo</button></span>}</td>
    </tr>
  );
}

/** Status line 1 during and after a Remove: "Rechecking without …" then the change summary, with Undo. */
export function RemovalStatus({ line, title, canUndo, onUndo }: { line: string; title: string; canUndo: boolean; onUndo: () => void }) {
  return (
    <p className="removal-line" data-testid="change-summary" role="status">
      <span data-testid="change-summary-text">{line}</span>
      {canUndo && <>{" "}<button className="btn link no-print" data-testid="undo-remove" onClick={onUndo}><Icon name="undo" />Undo, put {title} back</button></>}
    </p>
  );
}
