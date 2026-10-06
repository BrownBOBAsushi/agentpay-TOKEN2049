"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type RingRect = { left: number; top: number; width: number; height: number };
export function fitPencilRing(value: RingRect, wrapper: RingRect, padX = 14, padY = 14) {
  const width = Math.max(24, value.width + padX * 2);
  const height = Math.max(24, value.height + padY * 2);
  return { left: value.left - wrapper.left - padX, top: value.top - wrapper.top - padY, width, height,
    path: pencilEllipsePath(width, height) };
}

export function pencilEllipsePath(width: number, height: number) {
  const middle = height / 2;
  return `M ${width + 1} ${middle} C ${width + 2} ${height * .22}, ${width * .78} -1, ${width * .5} 1 C ${width * .22} -1, -1 ${height * .22}, 1 ${middle} C -1 ${height * .78}, ${width * .22} ${height + 1}, ${width * .5} ${height - 1} C ${width * .78} ${height + 2}, ${width + 2} ${height * .78}, ${width + 1} ${middle} Z`;
}

export function PencilRing({ fit = false }: { fit?: boolean }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!fit) return;
    const svg = svgRef.current;
    const target = svg?.parentElement?.querySelector<HTMLElement>(".value");
    const wrapper = svg?.parentElement;
    if (!svg || !pathRef.current || !target || !wrapper) return;
    const update = () => {
      // offset metrics stay in the wrapper's local CSS coordinate space, even when
      // the paper ancestor is tilted or scaled.
      const geometry = fitPencilRing(
        { left: target.offsetLeft, top: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight },
        { left: 0, top: 0, width: wrapper.clientWidth, height: wrapper.clientHeight },
      );
      svg.style.left = `${geometry.left}px`; svg.style.top = `${geometry.top}px`;
      svg.style.right = "auto"; svg.style.bottom = "auto";
      svg.style.width = `${geometry.width}px`; svg.style.height = `${geometry.height}px`;
      svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`);
      pathRef.current?.setAttribute("d", geometry.path);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(target); observer?.observe(wrapper);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [fit]);
  return <svg ref={svgRef} className="pencil-ring" data-fit={fit || undefined} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><filter id={id} x="-4%" y="-8%" width="108%" height="116%"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" result="rough" /><feDisplacementMap in="SourceGraphic" in2="rough" scale=".45" /></filter></defs>
    <path ref={pathRef} pathLength="1" filter={`url(#${id})`} d={pencilEllipsePath(300, 100)} />
  </svg>;
}
export function ReturnItem({ reasons, children, title = "RETURN ITEM · AgentPay Guard · Guard Check", label = "Return Item", className = "" }: { reasons: string[]; children?: ReactNode; title?: string; label?: string; className?: string }) {
  return <aside className={`return-item value ${className}`} aria-label={label}>
    <svg className="paper-clip" viewBox="0 0 36 90" aria-hidden="true"><path d="M12 70V18C12 1 32 1 32 18V73C32 93 3 93 3 73V24C3 11 23 11 23 24V67C23 77 12 77 12 67" /><path className="clip-highlight" d="M13 69V18C13 3 31 3 31 18V73" /></svg>
    <p>{title}</p>{children ?? <><p>Reason: REFER TO MAKER</p>
      <p className="return-reasons">{reasons.join(" · ")}</p>
      <p>This payment was not signed by its human. A new Mandate is required.</p></>}
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
