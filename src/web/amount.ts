// Six decimal places, kept as strings so even large atomic amounts stay exact.
export function decimalToAtomic(decimal: string): string {
  if (!/^\d+(?:\.\d{1,6})?$/.test(decimal)) throw new Error("Use a positive amount with up to 6 decimal places.");
  const [whole, fraction = ""] = decimal.split(".");
  const atomic = `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
  if (atomic === "0") throw new Error("Amount must be greater than zero.");
  return atomic;
}

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
