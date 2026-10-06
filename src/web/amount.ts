// Six decimal places, kept as strings so even large atomic amounts stay exact.
export function atomicToDecimal(atomic: string): string {
  if (!/^\d+$/.test(atomic)) throw new Error("Expected an atomic integer string");
  const padded = atomic.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
export function groupAtomic(atomic: string): string {
  if (!/^\d+$/.test(atomic)) throw new Error("Expected an atomic integer string");
  return atomic.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
