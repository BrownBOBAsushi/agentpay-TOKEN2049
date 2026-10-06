import canonicalize from "canonicalize";

export function jcs(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TypeError("Value has no JSON representation");
  }
  return result;
}
