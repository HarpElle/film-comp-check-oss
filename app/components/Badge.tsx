import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type BadgeKind = "Matched" | "Unmatched" | "Unscored" | "SetAside" | "NotRun";
const BADGE: Record<BadgeKind, { icon: IconName; label: string }> = {
  Matched: { icon: "check", label: "Matched" },
  Unmatched: { icon: "x", label: "Unmatched" },
  Unscored: { icon: "alert", label: "Unscored" },
  SetAside: { icon: "minus", label: "Set aside" },
  NotRun: { icon: "dot", label: "Not run" },
};

/** Badges and flags always carry an icon and a text label, never color alone. */
export function Badge({ kind }: { kind: BadgeKind }) {
  const b = BADGE[kind];
  return <span className={`badge ${kind}`} data-testid="badge"><Icon name={b.icon} />{b.label}</span>;
}
export function Flag({ kind, icon, children }: { kind: string; icon: IconName; children: ReactNode }) {
  return <span className={`flag ${kind}`} data-testid="flag"><Icon name={icon} />{children}</span>;
}
