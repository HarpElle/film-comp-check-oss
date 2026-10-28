/** A few Lucide icons (ISC license), inlined so no icon package is needed. Always paired with a word. */
const P: Record<string, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  split: ["M16 3h5v5", "M8 3H3v5", "M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3", "m15 9 6-6"],
  scissors: ["M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6", "M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6", "M20 4 8.12 15.88", "M14.47 14.48 20 20", "M8.12 8.12 12 12"],
  approx: ["M5 15a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0", "M5 9a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0"],
  alert: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 8v4", "M12 16h.01"],
  minus: ["M5 12h14"],
  dot: ["M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2"],
  down: ["M12 5v14", "m19 12-7 7-7-7"],
  warn: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  loader: ["M21 12a9 9 0 1 1-6.219-8.56"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  pencil: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
  refresh: ["M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16", "M16 16h5v5"],
  printer: ["M6 9V2h12v7", "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2", "M6 14h12v8H6z"],
  play: ["M6 3l14 9-14 9z"],
  circleHelp: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
};
export type IconName = keyof typeof P;
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <span className="icon" data-icon={name} aria-hidden="true" style={size !== 14 ? { width: size, height: size } : undefined}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {P[name].map((d, i) => <path key={i} d={d} />)}
      </svg>
    </span>
  );
}
