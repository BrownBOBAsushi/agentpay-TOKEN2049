"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function PencilRing() {
  const id = useId();
  return <svg className="pencil-ring" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><filter id={id} x="-10%" y="-20%" width="120%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" result="rough" /><feDisplacementMap in="SourceGraphic" in2="rough" scale=".7" /></filter></defs>
    <path pathLength="1" filter={`url(#${id})`} d="M300 50C300 22 230 0 150 0C68 0 0 22 0 50C0 78 68 100 150 100C230 100 300 78 300 50Z" />
  </svg>;
}
export function ReturnItem({ reasons }: { reasons: string[] }) {
  return <aside className="return-item value" aria-label="Return Item">
    <svg className="paper-clip" viewBox="0 0 36 90" aria-hidden="true"><path d="M12 70V18C12 1 32 1 32 18V73C32 93 3 93 3 73V24C3 11 23 11 23 24V67C23 77 12 77 12 67" /><path className="clip-highlight" d="M13 69V18C13 3 31 3 31 18V73" /></svg>
    <p>RETURN ITEM · AgentPay Guard · Guard Check</p><p>Reason: REFER TO MAKER</p>
    <p className="return-reasons">{reasons.join(" · ")}</p>
    <p>This payment was not signed by its human. A new Mandate is required.</p>
  </aside>;
}
export function LandingScene({ signed, presented, reasons }: { signed: ReactNode; presented: ReactNode; reasons: string[] }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const staticLayout = window.matchMedia("(max-width: 639px)");
    let observer: IntersectionObserver | undefined;
    const setup = () => {
      observer?.disconnect();
      delete root.dataset.step;
      if (motion.matches || staticLayout.matches) return;
      const markers = Array.from(root.querySelectorAll<HTMLElement>(".scene-sentinel"));
      const update = () => {
        const passed = markers.filter((marker) => marker.getBoundingClientRect().top <= window.innerHeight * .75).length;
        root.dataset.step = String(passed);
      };
      observer = new IntersectionObserver(update, { rootMargin: "0px 0px -25% 0px", threshold: [0, 1] });
      markers.forEach((marker) => observer!.observe(marker));
      update();
    };
    setup(); motion.addEventListener("change", setup); staticLayout.addEventListener("change", setup);
    return () => { observer?.disconnect(); motion.removeEventListener("change", setup); staticLayout.removeEventListener("change", setup); };
  }, []);
  return <section ref={ref} className="landing-sequence" id="presented" aria-label="The Guard Check returns the presented copy">
    <div className="scene-stage"><div className="scene-canvas"><div className="scene-signed">{signed}</div><div className="scene-forgery">{presented}<ReturnItem reasons={reasons} /></div></div></div>
    {[0, 1, 2, 3].map((step) => <span key={step} className="scene-sentinel" style={{ top: `${step * 25}%` }} aria-hidden="true" />)}
  </section>;
}
