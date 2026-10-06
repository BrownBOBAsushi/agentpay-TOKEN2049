export function guillochePaths(digestHex: string, opts: { size?: number; lines?: number } = {}): string[] {
  if (!/^[0-9a-f]{64}$/i.test(digestHex)) throw new Error("Expected a 32-byte digest");
  const bytes = digestHex.match(/../g)!.map((value) => parseInt(value, 16));
  let seed = 2166136261;
  for (const byte of bytes) seed = Math.imul(seed ^ byte, 16777619) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const size = opts.size ?? 600;
  const lines = opts.lines ?? 22 + Math.floor(random() * 7);
  if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(lines) || lines < 1 || lines > 64) throw new Error("Invalid rosette dimensions");
  const lobes = 7 + Math.floor(random() * 9);
  const secondary = 3 + Math.floor(random() * 5);
  const phase = random() * Math.PI * 2;
  const amplitude = .09 + random() * .08;
  return Array.from({ length: lines }, (_, line) => {
    const inset = line / lines;
    return Array.from({ length: 481 }, (_, point) => {
      const angle = point / 480 * Math.PI * 2;
      const radius = size * (.30 + inset * .13) * (1 + amplitude * Math.cos(lobes * angle + phase + inset * 2)
        + .035 * Math.sin(secondary * angle - phase));
      const x = size / 2 + radius * Math.cos(angle);
      const y = size / 2 + radius * Math.sin(angle);
      return `${point ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ") + " Z";
  });
}
