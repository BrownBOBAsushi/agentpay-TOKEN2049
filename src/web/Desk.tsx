import type { ReactNode } from "react";

// A small cached SVG tile, never a viewport-sized live filter.
const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/></filter><rect width="256" height="256" filter="url(#g)" opacity=".18"/></svg>`;
export function Desk({ children }: { children: ReactNode }) {
  return <><div className="desk-surface" aria-hidden="true"><div className="desk-grain" style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(grain)}")` }} /><div className="desk-tooling" /></div><div className="desk-content">{children}</div></>;
}
