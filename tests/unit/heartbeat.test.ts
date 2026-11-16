import { expect, test } from "bun:test";
import { Heartbeat } from "../../src/workers/heartbeat";

test("heartbeat never overlaps extensions; stop drains before release/backoff", async () => {
  let entered!: () => void;
  let release!: () => void;
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heartbeat = new Heartbeat(
    5,
    async () => {
      calls++;
      active++;
      maxActive = Math.max(active, maxActive);
      entered();
      await gate;
      active--;
    },
    () => {},
  );
  await started;
  await Bun.sleep(25);
  let stopped = false;
  const closing = heartbeat.stop().then(() => {
    stopped = true;
  });
  await Bun.sleep(10);
  expect(stopped).toBe(false);
  expect(calls).toBe(1);
  expect(maxActive).toBe(1);
  release();
  await closing;
  await Bun.sleep(15);
  expect(calls).toBe(1);
  expect(active).toBe(0);
});
