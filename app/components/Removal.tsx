import { Icon } from "./Icon";

/** The collapsed row a removed comp leaves while the deck is rechecked. */
export function RemovedRow({ title, cols, order }: { title: string; cols: number; order: number }) {
  return (
    <tr className="comp removed" data-testid="removed-row" data-title={title} style={{ ["--o" as string]: order }}>
      <td colSpan={cols}><s className="film">{title}</s> <span className="removed-tag">Removed</span></td>
    </tr>
  );
}

/** Status line 1 during and after a Remove: "Rechecking without …" then the change summary, with Undo. */
export function RemovalStatus({ line, title, canUndo, onUndo }: { line: string; title: string; canUndo: boolean; onUndo: () => void }) {
  return (
    <p className="removal-line" data-testid="change-summary">
      <span data-testid="change-summary-text">{line}</span>
      {canUndo && <>{" "}<button className="btn link no-print" data-testid="undo-remove" onClick={onUndo}><Icon name="undo" />Undo, put {title} back</button></>}
    </p>
  );
}
