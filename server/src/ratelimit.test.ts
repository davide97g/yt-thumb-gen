import { expect, test } from "bun:test";
import { createLimiter } from "./ratelimit";

const opts = { limit: 3, windowMs: 1000 };

test("allows up to the limit, then refuses", () => {
  const l = createLimiter(opts);
  for (let i = 0; i < 3; i++) {
    expect(l.check("a", 0).ok).toBe(true);
    l.fail("a", 0);
  }
  expect(l.check("a", 0)).toEqual({ ok: false, retryAfterMs: 1000 });
});

test("the window slides — the wait shrinks as attempts age out", () => {
  const l = createLimiter(opts);
  l.fail("a", 0);
  l.fail("a", 100);
  l.fail("a", 200);
  expect(l.check("a", 400)).toEqual({ ok: false, retryAfterMs: 600 });
  expect(l.check("a", 1001).ok).toBe(true); // the first attempt expired, freeing a slot
});

test("keys don't bleed into each other", () => {
  const l = createLimiter(opts);
  for (let i = 0; i < 3; i++) l.fail("a", 0);
  expect(l.check("a", 0).ok).toBe(false);
  expect(l.check("b", 0).ok).toBe(true);
});

test("a success clears the record, so one typo never lingers", () => {
  const l = createLimiter(opts);
  for (let i = 0; i < 3; i++) l.fail("a", 0);
  l.reset("a");
  expect(l.check("a", 0).ok).toBe(true);
});

test("expired keys are dropped rather than kept forever", () => {
  const l = createLimiter(opts);
  l.fail("a", 0);
  expect(l.size()).toBe(1);
  l.check("a", 2000);
  expect(l.size()).toBe(0);
});

test("a spray of unique keys stays bounded", () => {
  const l = createLimiter({ ...opts, maxKeys: 10 });
  for (let i = 0; i < 500; i++) l.fail(`key-${i}`, 0); // all within the window, none expired
  expect(l.size()).toBeLessThanOrEqual(10);
});
