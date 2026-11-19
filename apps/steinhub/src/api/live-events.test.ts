import type { ServerFrame } from "@openmausbot/phone-protocol/wire.ts";
import type { StreamFrame } from "@/api/client";
import { DesktopError } from "@/api/errors";
import { startLiveEvents, type LinkState, type LiveEventsOptions } from "@/api/live-events";

interface Attempt {
  since: string | null;
  emit: (frame: ServerFrame, cursor?: string) => void;
  end: () => void;
  fail: (error: unknown) => void;
  signal: AbortSignal;
}

function harness(overrides: Partial<LiveEventsOptions> = {}) {
  const attempts: Attempt[] = [];
  const frames: ServerFrame[] = [];
  const states: LinkState[] = [];
  const snapshot = jest.fn(() => Promise.resolve());
  const unreachable = jest.fn();
  const events = startLiveEvents({
    open: (since, onFrame, signal) =>
      new Promise<void>((resolve, reject) => {
        attempts.push({
          since,
          emit: (frame, cursor) => onFrame({ frame, cursor } satisfies StreamFrame),
          end: resolve,
          fail: reject,
          signal,
        });
      }),
    snapshot,
    onFrame: (frame) => frames.push(frame),
    onState: (state) => states.push(state),
    onUnreachable: unreachable,
    staleMs: 40_000,
    retryMinMs: 500,
    retryMaxMs: 4_000,
    ...overrides,
  });
  return { events, attempts, frames, states, snapshot, unreachable };
}

const flush = () => new Promise<void>((resolve) => jest.requireActual<typeof globalThis>("timers").setImmediate(resolve));

beforeEach(() => jest.useFakeTimers({ doNotFake: ["setImmediate"] }));
afterEach(() => jest.useRealTimers());

test("a fresh stream loads a snapshot before applying frames, then resumes from the newest cursor", async () => {
  const { events, attempts, frames, states, snapshot } = harness();
  attempts[0].emit({ kind: "hello", cursor: "s:1", resumed: false });
  attempts[0].emit({ kind: "bot.deleted", botId: "b1" }, "s:2");
  expect(frames).toEqual([]);
  await flush();
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(frames).toEqual([{ kind: "bot.deleted", botId: "b1" }]);
  expect(states).toEqual(["connecting", "online"]);

  attempts[0].fail(new DesktopError("offline", "wifi dropped"));
  await flush();
  expect(states.at(-1)).toBe("offline");
  jest.advanceTimersByTime(500);
  expect(attempts).toHaveLength(2);
  expect(attempts[1].since).toBe("s:2");
  attempts[1].emit({ kind: "hello", cursor: "s:2", resumed: true });
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toBe("online");
  events.stop();
});

test("backs off between failed attempts and moves to the next address", async () => {
  const { events, attempts, unreachable } = harness();
  for (const wait of [500, 1_000, 2_000, 4_000, 4_000]) {
    attempts.at(-1)!.fail(new DesktopError("offline", "down"));
    await flush();
    const before = attempts.length;
    jest.advanceTimersByTime(wait - 1);
    expect(attempts).toHaveLength(before);
    jest.advanceTimersByTime(1);
    expect(attempts).toHaveLength(before + 1);
  }
  expect(unreachable).toHaveBeenCalledTimes(5);
  events.stop();
});

test("a revoked token stops retrying until asked", async () => {
  const { events, attempts, states } = harness();
  attempts[0].fail(new DesktopError("signed-out", "pair this device", { status: 401 }));
  await flush();
  jest.advanceTimersByTime(60_000);
  expect(attempts).toHaveLength(1);
  expect(states.at(-1)).toBe("signed-out");
  events.retryNow();
  expect(attempts).toHaveLength(2);
  events.stop();
});

test("a silent stream is dropped and reopened", async () => {
  const { events, attempts } = harness();
  attempts[0].emit({ kind: "hello", cursor: "s:1", resumed: true });
  jest.advanceTimersByTime(40_000);
  expect(attempts[0].signal.aborted).toBe(true);
  jest.advanceTimersByTime(500);
  expect(attempts).toHaveLength(2);
  events.stop();
});

test("stop closes the stream and schedules nothing", async () => {
  const { events, attempts } = harness();
  events.stop();
  expect(attempts[0].signal.aborted).toBe(true);
  attempts[0].end();
  await flush();
  jest.advanceTimersByTime(60_000);
  expect(attempts).toHaveLength(1);
});
