function digestRandom(digestHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(digestHex)) throw new Error("Expected a 32-byte digest");
  let seed = 2166136261;
  for (const byte of digestHex.match(/../g)!) seed = Math.imul(seed ^ parseInt(byte, 16), 16777619) >>> 0;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}

export function guillochePaths(digestHex: string, opts: { size?: number; lines?: number } = {}): string[] {
  const random = digestRandom(digestHex);
  const size = opts.size ?? 600;
  const lines = opts.lines ?? 40 + Math.floor(random() * 31);
  if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(lines) || lines < 40 || lines > 70) throw new Error("Invalid rosette dimensions");
  const ratio = 5 + Math.floor(random() * 7);
  const phase = random() * Math.PI * 2;
  const pen = size * (.13 + random() * .04);
  const orbit = size * .27;
  // Integer R/r makes the hypotrochoid close after one revolution.
  return Array.from({ length: lines }, (_, line) => {
    const rotation = phase + line / lines * Math.PI * 2 / (ratio + 1);
    const d = pen * (.86 + .14 * line / lines);
    const points = Array.from({ length: 721 }, (_, point) => {
      const angle = point / 720 * Math.PI * 2;
      const x = orbit * Math.cos(angle) + d * Math.cos(ratio * angle);
      const y = orbit * Math.sin(angle) - d * Math.sin(ratio * angle);
      return `${point ? "L" : "M"}${(size / 2 + x * Math.cos(rotation) - y * Math.sin(rotation)).toFixed(2)},${(size / 2 + x * Math.sin(rotation) + y * Math.cos(rotation)).toFixed(2)}`;
    });
    return points.join(" ") + " Z";
  });
}

export function guillocheBorderPaths(digestHex: string): string[] {
  const random = digestRandom(digestHex);
  const phase = random() * Math.PI * 2;
  const cycles = 60 + Math.floor(random() * 21);
  const width = 1200, height = 600, inset = 9;
  const perimeter = 2 * (width + height - 4 * inset);
  return Array.from({ length: 4 }, (_, line) => Array.from({ length: 1441 }, (_, i) => {
    const position = i / 1440 * perimeter;
    const wave = 3 * Math.sin(i / 1440 * Math.PI * 2 * cycles + phase + line * Math.PI / 2);
    const w = width - 2 * inset, h = height - 2 * inset;
    const x = position <= w ? inset + position : position <= w + h ? width - inset
      : position <= 2 * w + h ? width - inset - (position - w - h) : inset;
    const y = position <= w ? inset : position <= w + h ? inset + position - w
      : position <= 2 * w + h ? height - inset : height - inset - (position - 2 * w - h);
    const nx = position <= w || (position > w + h && position <= 2 * w + h) ? 0 : wave;
    const ny = nx === 0 ? wave : 0;
    return `${i ? "L" : "M"}${(x + nx).toFixed(2)},${(y + ny).toFixed(2)}`;
  }).join(" ") + " Z");
}
