"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { guillocheWaveStrands, twoInkGuilloche } from "./guilloche";

const MICROPRINT = "AGENTPAY GUARD · SIGNED INTENT · ";

function Microprint({ className, style }: { className: string; style?: CSSProperties }) {
  const svg = useRef<SVGSVGElement>(null);
  const sample = useRef<SVGTextElement>(null);
  const [length, setLength] = useState({ count: 32, phrase: 82 });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const phrase = sample.current?.getComputedTextLength() ?? 0;
      if (phrase > 0) setLength({ count: Math.ceil(element.getBoundingClientRect().width / phrase) + 1, phrase });
    };
    const observer = new ResizeObserver(measure); observer.observe(element);
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, []);
  return <svg ref={svg} className={`microprint ${className}`} style={style} aria-hidden="true" focusable="false">
    <text ref={sample} x="0" y="4.5" visibility="hidden">{MICROPRINT}</text>
    <text x="0" y="4.5" textLength={length.count * length.phrase} lengthAdjust="spacing">{MICROPRINT.repeat(length.count)}</text>
  </svg>;
}

export function EngravedSeal() {
  const rosette = Array.from({ length: 181 }, (_, i) => {
    const angle = i / 180 * Math.PI * 2;
    const radius = 8 + 2 * Math.cos(8 * angle);
    return `${i ? "L" : "M"}${(30 + radius * Math.cos(angle)).toFixed(3)},${(30 + radius * Math.sin(angle)).toFixed(3)}`;
  }).join(" ") + " Z";
  return <svg className="engraved-seal" viewBox="0 0 60 60" aria-hidden="true" focusable="false">
    {[28, 26, 21, 18, 13].map((radius) => <circle key={radius} cx="30" cy="30" r={radius} />)}
    {Array.from({ length: 48 }, (_, i) => {
      const angle = i / 48 * Math.PI * 2;
      return <path key={i} d={`M${30 + 21 * Math.cos(angle)},${30 + 21 * Math.sin(angle)}L${30 + 26 * Math.cos(angle + .035)},${30 + 26 * Math.sin(angle + .035)}`} />;
    })}
    <path d={rosette} />
  </svg>;
}

export function SecurityPaper({ digest, presented = false }: { digest: string | null; presented?: boolean }) {
  const id = useId().replace(/:/g, "");
  const layer = useRef<HTMLDivElement>(null);
  const [signature, setSignature] = useState<{ left: number; top: number; width: number } | null>(null);
  const [layout, setLayout] = useState<{ width: number; height: number; values: { x: number; y: number; width: number; height: number }[] } | null>(null);
  const inks = useMemo(() => digest ? twoInkGuilloche(digest) : null, [digest]);
  useEffect(() => {
    const overlay = layer.current;
    const paper = overlay?.parentElement;
    if (!paper || !overlay) return;
    // The edit form supplies its own signature field. Measure that field rather
    // than duplicate or change its form markup. This overlay never captures input.
    const content = paper.querySelector(".cheque-content");
    const measure = () => {
      const origin = overlay.getBoundingClientRect();
      // Paper objects rotate, but the ink mask uses untransformed paper coordinates.
      // Inverse-map all four viewport corners: this conservatively clears the full
      // value even when that value has its own rotation (for example the stamp).
      let angle = 0;
      for (let ancestor: HTMLElement | null = overlay; ancestor; ancestor = ancestor.parentElement) {
        const transform = getComputedStyle(ancestor).transform;
        if (transform !== "none") {
          const matrix = new DOMMatrixReadOnly(transform);
          angle += Math.atan2(matrix.b, matrix.a);
        }
      }
      const local = (rect: DOMRect) => {
        const points = [rect.left, rect.right].flatMap((x) => [rect.top, rect.bottom].map((y) => {
          const dx = x - (origin.left + origin.width / 2);
          const dy = y - (origin.top + origin.height / 2);
          return { x: dx * Math.cos(angle) + dy * Math.sin(angle) + overlay.clientWidth / 2,
            y: -dx * Math.sin(angle) + dy * Math.cos(angle) + overlay.clientHeight / 2 };
        }));
        const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
        return { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y };
      };
      const values = Array.from(paper.querySelectorAll(".value")).flatMap((value) => Array.from(value.getClientRects()).map(local));
      const next = { width: overlay.clientWidth, height: overlay.clientHeight, values };
      setLayout((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      const target = paper.querySelector(".signature-line, .signature-block .signature-short, .signature-block > p:last-child");
      if (target) {
        const rect = local(target.getBoundingClientRect());
        setSignature({ left: rect.x, top: rect.y + rect.height - (target.matches(".signature-line") ? 5 : -2), width: rect.width });
      }
    };
    const observer = new ResizeObserver(measure); observer.observe(paper);
    if (content) observer.observe(content);
    const mutations = new MutationObserver(measure);
    if (content) mutations.observe(content, { childList: true, characterData: true, subtree: true });
    let active = true;
    void document.fonts.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); mutations.disconnect(); };
  }, []);
  const size = layout ? Math.min(layout.width * .36, 540) : 0;
  return <div className="security-paper" aria-hidden="true" ref={layer}>
    <div className="rainbow-paper" />
    <svg className="security-inks" width="100%" height="100%" focusable="false" style={{ visibility: layout ? "visible" : "hidden" }}>
      <defs>
        <filter id={`${id}-feather`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" /></filter>
        <mask id={`${id}-values`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{ maskType: "luminance" }}>
          <rect width="100%" height="100%" fill="white" />
          <g fill="black" filter={`url(#${id}-feather)`}>{layout?.values.map((rect, i) =>
            <rect key={i} x={rect.x - 8} y={rect.y - 8} width={rect.width + 16} height={rect.height + 16} />)}</g>
        </mask>
        <pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" width="3" height="3"><circle cx="1.5" cy="1.5" r=".3" fill="var(--ink)" /></pattern>
        {presented && <>
          <pattern id={`${id}-copy-dots`} patternUnits="userSpaceOnUse" width="2" height="2"><circle cx="1" cy="1" r=".3" fill="var(--ink)" /></pattern>
          <text id={`${id}-copy-word`} x="32%" y="60%" textAnchor="middle" className="copy-latent" fontSize={(layout?.height ?? 0) * .4} textLength={(layout?.width ?? 0) * .56} lengthAdjust="spacingAndGlyphs">COPY</text>
          <clipPath id={`${id}-copy`}><use href={`#${id}-copy-word`} /></clipPath>
          <mask id={`${id}-outside-copy`} x="0" y="0" width="100%" height="100%" style={{ maskType: "luminance" }}>
            <rect width="100%" height="100%" fill="white" /><use href={`#${id}-copy-word`} fill="black" />
          </mask>
        </>}
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="1" stitchTiles="stitch" seed="14" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.08627451 0 0 0 0 0.18823529 0 0 0 0 0.22745098 1 0 0 0 0" />
        </filter>
      </defs>
      <g mask={`url(#${id}-values)`}>
        {inks && <svg className="guilloche-field" x={(layout?.width ?? 0) * .98 - size} y={((layout?.height ?? 0) - size) / 2} width={size} height={size} viewBox="0 0 600 600">
          <g className="sage-ink">{inks.sage.map((path, i) => <path key={i} d={path} />)}</g>
          <g className="bronze-ink" transform="translate(42 30) scale(.88)">{inks.bronze.map((path, i) => <path key={i} d={path} />)}</g>
        </svg>}
        <rect className="pantograph" width="100%" height="100%" fill={`url(#${id}-dots)`} mask={presented ? `url(#${id}-outside-copy)` : undefined} />
        {presented && <rect className="copy-pantograph" data-pantograph="COPY" width="100%" height="100%" fill={`url(#${id}-copy-dots)`} clipPath={`url(#${id}-copy)`} />}
        <rect className="paper-grain" width="100%" height="100%" filter={`url(#${id}-grain)`} />
      </g>
    </svg>
    {(["top", "bottom", "left", "right"] as const).map((edge) => {
      const vertical = edge === "left" || edge === "right";
      return <svg key={edge} className={`wave-band wave-${edge}`} focusable="false">
        <defs><pattern id={`${id}-wave-${edge}`} width={vertical ? 9 : 64} height={vertical ? 64 : 9} patternUnits="userSpaceOnUse">
          {guillocheWaveStrands(vertical).map((path, i) => <path key={i} d={path} />)}
        </pattern></defs><rect width="100%" height="100%" fill={`url(#${id}-wave-${edge})`} stroke="none" />
      </svg>;
    })}
    <Microprint className="frame-microprint" />
    {signature && <Microprint className="signature-microprint" style={signature} />}
  </div>;
}
