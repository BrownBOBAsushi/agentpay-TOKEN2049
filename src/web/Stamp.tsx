"use client";

import { useEffect, useId, useRef } from "react";

const punches: Record<string, string[]> = {
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};

export function Stamp({ variant = "returned", reasons = [], animate = false }: {
  variant?: "returned" | "cleared"; reasons?: string[]; animate?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const spread = useRef<SVGAnimateElement>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const element = ref.current;
    if (!element || !animate || variant !== "returned") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !("IntersectionObserver" in window)) return;
    element.dataset.motion = "ready";
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        element.dataset.motion = "pressed";
        spread.current?.beginElement();
        observer.disconnect();
      }
    }, { threshold: .25 });
    observer.observe(element.closest(".cheque") ?? element);
    const reduce = () => { if (motion.matches) { element.dataset.motion = "final"; observer.disconnect(); } };
    motion.addEventListener("change", reduce);
    return () => { observer.disconnect(); motion.removeEventListener("change", reduce); };
  }, [animate, variant]);

  if (variant === "cleared") return <svg className="stamp stamp-cleared" viewBox="0 0 264 58" role="img" aria-label="CLEARED">
    {Array.from("CLEARED").flatMap((letter, index) => punches[letter].flatMap((row, y) => Array.from(row).flatMap((dot, x) => dot === "1"
      ? [<circle key={`${index}-${x}-${y}`} cx={12 + index * 36 + x * 6} cy={10 + y * 6} r="1.9" />] : [])))}
  </svg>;

  return <svg ref={ref} className="stamp stamp-returned" viewBox="0 0 460 160" role="img" aria-label={`RETURNED: ${reasons.join(", ")}`}>
    <defs><filter id={`stamp-${id}`} x="-10%" y="-20%" width="120%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="8" result="grain" />
      <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="imprint" />
      <feMorphology in="imprint" operator="dilate" radius=".6">
        <animate ref={spread} attributeName="radius" values="0;.6" dur="420ms" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".16 1 .3 1" />
      </feMorphology>
    </filter></defs>
    <g filter={`url(#stamp-${id})`}>
      <rect x="8" y="10" width="444" height="140" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="16" width="432" height="128" fill="none" stroke="currentColor" strokeWidth="1" />
      <text x="230" y="93" textAnchor="middle" className="stamp-word">RETURNED</text>
      <text x="230" y="125" textAnchor="middle" className="stamp-reasons">{reasons.join(" · ")}</text>
    </g>
  </svg>;
}
