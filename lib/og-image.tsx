import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { COPY } from "./copy";

/**
 * The share image (design spec: share image) and the apple-touch icon, rendered at build time from the repo's
 * own fonts, logo and copy. Built, not committed: the public scan allows no raster images in the repo.
 */
const asset = (p: string) => readFile(join(process.cwd(), "public", p));
const C = { ink: "#333333", muted: "#6A6A6A", orange: "#E69F00", orange100: "#FBEFD2", orangeInk: "#7A5300" };

async function logo(height: number) {
  const svg = (await asset("brand/logo-mark.svg")).toString("utf8");
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} height={height} width={Math.round((height * 46) / 36)} alt="" />;
}

export async function ogImage() {
  // Static Inter instances (assets/og, cut from public/fonts/Inter-Variable.ttf with fontTools): the renderer can't read variable fonts.
  const og = (f: string) => readFile(join(process.cwd(), "assets/og", f));
  const [inter, inter600, cond, mono] = await Promise.all([og("Inter-Regular-static.ttf"), og("Inter-SemiBold-static.ttf"), asset("fonts/IBMPlexSansCondensed-SemiBold.ttf"), asset("fonts/IBMPlexMono-Regular.ttf")]);
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, padding: "64px 80px", background: "#FFFFFF", color: C.ink, display: "flex", flexDirection: "column", justifyContent: "space-between", fontFamily: "Inter" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {await logo(72)}
          <span style={{ fontFamily: "Plex Condensed", fontWeight: 600, fontSize: 72, lineHeight: 1 }}>Film Comp Check</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 960 }}>
          <div style={{ fontSize: 44, lineHeight: 1.25, marginBottom: 16 }}>{COPY.purpose}</div>
          <div style={{ fontSize: 26, lineHeight: 1.35, color: C.muted }}>{COPY.sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `3px solid ${C.ink}`, paddingTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", background: C.orange100, border: `2px solid ${C.orange}`, borderRadius: 6, padding: "10px 18px", color: C.orangeInk }}>
            <span style={{ fontSize: 26, fontWeight: 600, whiteSpace: "nowrap" }}>Audience outlier</span>
            <span style={{ fontSize: 18, whiteSpace: "nowrap" }}>(Qloo&apos;s estimate)</span>
          </div>
          <span style={{ fontFamily: "Plex Mono", fontSize: 24, color: C.muted }}>filmcompcheck.com</span>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: [
        { name: "Inter", data: inter, weight: 400, style: "normal" },
        { name: "Inter", data: inter600, weight: 600, style: "normal" },
        { name: "Plex Condensed", data: cond, weight: 600, style: "normal" },
        { name: "Plex Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}

export async function touchIcon() {
  return new ImageResponse(<div style={{ width: 180, height: 180, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>{await logo(104)}</div>, { width: 180, height: 180 });
}
