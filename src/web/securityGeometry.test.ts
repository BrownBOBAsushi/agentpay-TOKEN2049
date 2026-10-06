import { expect, test } from "vitest";
import { inverseMapBox } from "./securityGeometry";

test("inverse mapping restores paper-local bounds after scene scale and rotation", () => {
  const scale = .618;
  const angle = 2.5 * Math.PI / 180;
  const matrix = {
    a: scale * Math.cos(angle), b: scale * Math.sin(angle),
    c: -scale * Math.sin(angle), d: scale * Math.cos(angle), e: 310, f: 145,
  };
  const local = { left: 220, top: 440, right: 360, bottom: 480 };
  const viewport = [
    [local.left, local.top], [local.right, local.top],
    [local.left, local.bottom], [local.right, local.bottom],
  ].map(([x, y]) => ({ x: matrix.a * x! + matrix.c * y! + matrix.e, y: matrix.b * x! + matrix.d * y! + matrix.f }));
  const bounds = {
    left: Math.min(...viewport.map((point) => point.x)),
    top: Math.min(...viewport.map((point) => point.y)),
    right: Math.max(...viewport.map((point) => point.x)),
    bottom: Math.max(...viewport.map((point) => point.y)),
  };

  const recovered = inverseMapBox(bounds, matrix)!;
  expect(recovered.x).toBeLessThanOrEqual(local.left);
  expect(recovered.y).toBeLessThanOrEqual(local.top);
  expect(recovered.x + recovered.width).toBeGreaterThanOrEqual(local.right);
  expect(recovered.y + recovered.height).toBeGreaterThanOrEqual(local.bottom);
  expect(recovered.x + recovered.width / 2).toBeCloseTo((local.left + local.right) / 2, 8);
  expect(recovered.y + recovered.height / 2).toBeCloseTo((local.top + local.bottom) / 2, 8);
});

test("singular transforms do not produce invalid mask coordinates", () => {
  expect(inverseMapBox({ left: 0, top: 0, right: 10, bottom: 10 }, {
    a: 1, b: 2, c: 2, d: 4, e: 0, f: 0,
  })).toBeNull();
});
