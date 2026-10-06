export type AffineMatrix = Pick<DOMMatrixReadOnly, "a" | "b" | "c" | "d" | "e" | "f">;
export type Box = { left: number; top: number; right: number; bottom: number };

/** Map a viewport-space axis-aligned box back into local coordinates. */
export function inverseMapBox(box: Box, matrix: AffineMatrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const map = (x: number, y: number) => {
    const dx = x - matrix.e;
    const dy = y - matrix.f;
    return {
      x: (matrix.d * dx - matrix.c * dy) / determinant,
      y: (-matrix.b * dx + matrix.a * dy) / determinant,
    };
  };
  const points = [
    map(box.left, box.top), map(box.right, box.top),
    map(box.left, box.bottom), map(box.right, box.bottom),
  ];
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
