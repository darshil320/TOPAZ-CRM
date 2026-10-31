/** Run: npm run test:unit (Node's built-in runner, TS via type stripping). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProductCode, normalizeProductCode, productPath } from "./productCode.ts";

test("normalizes the same way as the API", () => {
  assert.equal(normalizeProductCode("7k3m-9qxa"), "7K3M9QXA");
  assert.equal(normalizeProductCode(" 7K3M 9QXA "), "7K3M9QXA");
  assert.equal(normalizeProductCode("OK3MIQXL"), "0K3M1QX1");
});

test("rejects anything that is not a code", () => {
  for (const raw of [null, 42, "", "7K3M9QX", "7K3M9QXAB", "7K3M9QXU", "x".repeat(100)]) {
    assert.equal(normalizeProductCode(raw), null, String(raw));
  }
});

test("extracts the code from a sticker URL", () => {
  assert.equal(extractProductCode("https://topaz.dmcdigital.in/p/7K3M9QXA"), "7K3M9QXA");
  assert.equal(extractProductCode("https://topaz.dmcdigital.in/p/7k3m9qxa/"), "7K3M9QXA");
  assert.equal(extractProductCode("https://tpz.in/P/7K3M9QXA?utm=sticker"), "7K3M9QXA");
});

test("accepts a bare code typed by hand", () => {
  assert.equal(extractProductCode("  7K3M-9QXA "), "7K3M9QXA");
});

test("refuses foreign or malformed QR content", () => {
  for (const text of [
    "https://evil.example/login",
    "https://evil.example/p/../../admin",
    "https://topaz.dmcdigital.in/q/7K3M9QXA",
    "WIFI:S:Showroom;T:WPA;P:secret;;",
    "javascript:alert(1)",
    "https://topaz.dmcdigital.in/p/7K3M9QXA/extra",
    "https://topaz.dmcdigital.in/p/%E0%A4%A",
    "",
    "x".repeat(2000),
  ]) {
    assert.equal(extractProductCode(text), null, text);
  }
});

test("routes only to our own relative path", () => {
  assert.equal(productPath("7K3M9QXA"), "/p/7K3M9QXA");
});
