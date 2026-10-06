function digestRandom(digestHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(digestHex)) throw new Error("Expected a 32-byte digest");
  let seed = 2166136261;
  for (const byte of digestHex.match(/../g)!) seed = Math.imul(seed ^ parseInt(byte, 16), 16777619) >>> 0;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}

export function guillochePaths(digestHex: string, opts: { size?: number; lines?: number; ratio?: number; spread?: boolean } = {}): string[] {
  const random = digestRandom(digestHex);
  const size = opts.size ?? 600;
  const lines = opts.lines ?? 40 + Math.floor(random() * 31);
  if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(lines) || lines < 24 || lines > 70) throw new Error("Invalid rosette dimensions");
  const ratio = opts.ratio ?? 5 + Math.floor(random() * 7);
  if (!Number.isInteger(ratio) || ratio < 5 || ratio > 12) throw new Error("Invalid rosette ratio");
  const phase = random() * Math.PI * 2;
  const pen = size * (.13 + random() * .04);
  const orbit = size * .27;
  // Integer R/r makes the hypotrochoid close after one revolution.
  return Array.from({ length: lines }, (_, line) => {
    const rotation = phase + line / lines * Math.PI * 2 / (ratio + 1);
    const fraction = line / (lines - 1);
    const d = pen * (opts.spread ? .35 + .65 * fraction : .86 + .14 * fraction);
    const ringOrbit = opts.spread ? orbit * (.7 + .3 * fraction) : orbit;
    const points = Array.from({ length: 721 }, (_, point) => {
      const angle = point / 720 * Math.PI * 2;
      const x = ringOrbit * Math.cos(angle) + d * Math.cos(ratio * angle);
      const y = ringOrbit * Math.sin(angle) - d * Math.sin(ratio * angle);
      return `${point ? "L" : "M"}${(size / 2 + x * Math.cos(rotation) - y * Math.sin(rotation)).toFixed(2)},${(size / 2 + x * Math.sin(rotation) + y * Math.cos(rotation)).toFixed(2)}`;
    });
    return points.join(" ") + " Z";
  });
}

export function twoInkGuilloche(digestHex: string) {
  const random = digestRandom(digestHex);
  const firstRatio = 5 + Math.floor(random() * 3);
  // The bronze plate has its own seed, taken only from the second half.
  const secondHalf = digestHex.slice(32).repeat(2);
  const secondRatio = 8 + Math.floor(digestRandom(secondHalf)() * 4);
  return {
    sage: guillochePaths(digestHex, { ratio: firstRatio, lines: 30, spread: true }),
    bronze: guillochePaths(secondHalf, { ratio: secondRatio, lines: 30, spread: true }),
    firstLobes: firstRatio + 1, secondLobes: secondRatio + 1,
  };
}

// One 64px repeat of four phase-shifted sine strands within a 9px strip.
export function guillocheWaveStrands(vertical = false): string[] {
  return Array.from({ length: 4 }, (_, strand) => Array.from({ length: 129 }, (_, point) => {
    const along = point / 128 * 64;
    const across = 4.5 + 4 * Math.sin(point / 128 * 2 * Math.PI + strand * Math.PI / 2);
    return `${point ? "L" : "M"}${(vertical ? across : along).toFixed(3)},${(vertical ? along : across).toFixed(3)}`;
  }).join(" "));
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
