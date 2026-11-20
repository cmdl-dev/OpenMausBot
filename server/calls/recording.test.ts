import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCallRecorder, mulawToPcm, repairRecording, wavHeader } from "./recording.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-recording-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const LOUD = 0x80;
const SOFT = 0x9f;
const tone = (byte: number, ms: number) => Buffer.alloc(ms * 8, byte);

function samples(path: string): Int16Array {
  const file = readFileSync(path);
  return new Int16Array(file.buffer.slice(file.byteOffset + 44, file.byteOffset + file.length));
}

describe("a call recording", () => {
  it("writes a mono 16-bit 8 kHz PCM WAV header whose sizes match the data", () => {
    const header = wavHeader(16_000);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.readUInt32LE(4)).toBe(36 + 16_000);
    expect(header.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect([header.readUInt32LE(16), header.readUInt16LE(20), header.readUInt16LE(22), header.readUInt32LE(24), header.readUInt32LE(28), header.readUInt16LE(32), header.readUInt16LE(34)])
      .toEqual([16, 1, 1, 8_000, 16_000, 2, 16]);
    expect(header.toString("ascii", 36, 40)).toBe("data");
    expect(header.readUInt32LE(40)).toBe(16_000);
  });

  it("places the callee and the voice on one timeline and mixes where they overlap", () => {
    const path = join(dir, "recordings", "c-1.wav");
    const recorder = createCallRecorder(path);
    recorder.inbound(0, tone(LOUD, 100));
    recorder.outbound(50, tone(SOFT, 100));
    const done = recorder.finish();
    const pcm = samples(path);
    expect(pcm.length).toBe(150 * 8);
    expect(pcm[0]).toBe(mulawToPcm(LOUD));
    expect(pcm[50 * 8 - 1]).toBe(mulawToPcm(LOUD));
    expect(pcm[50 * 8]).toBe(Math.min(32_767, mulawToPcm(LOUD) + mulawToPcm(SOFT)));
    expect(pcm[120 * 8]).toBe(mulawToPcm(SOFT));
    expect(done).toEqual({ path, bytes: 44 + 150 * 8 * 2, seconds: 0 });
    const header = readFileSync(path).subarray(0, 44);
    expect(header.readUInt32LE(40)).toBe(150 * 8 * 2);
    expect(header.readUInt32LE(4)).toBe(36 + 150 * 8 * 2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "recordings")).mode & 0o777).toBe(0o700);
  });

  it("plays the voice's chunks back to back, as Twilio queues them", () => {
    const path = join(dir, "c-2.wav");
    const recorder = createCallRecorder(path);
    recorder.outbound(0, tone(SOFT, 40));
    recorder.outbound(0, tone(LOUD, 40));
    recorder.finish();
    const pcm = samples(path);
    expect(pcm.length).toBe(80 * 8);
    expect(pcm[39 * 8]).toBe(mulawToPcm(SOFT));
    expect(pcm[40 * 8]).toBe(mulawToPcm(LOUD));
  });

  it("leaves out the voice's audio that Twilio cleared when the callee talked over it", () => {
    const path = join(dir, "c-3.wav");
    const recorder = createCallRecorder(path);
    recorder.outbound(0, tone(SOFT, 2_000));
    recorder.clearOutbound(300);
    recorder.inbound(300, tone(LOUD, 200));
    recorder.outbound(600, tone(SOFT, 100));
    recorder.finish();
    const pcm = samples(path);
    expect(pcm.length).toBe(700 * 8);
    expect(pcm[299 * 8]).toBe(mulawToPcm(SOFT));
    expect(pcm[300 * 8]).toBe(mulawToPcm(LOUD));
    expect(pcm[550 * 8]).toBe(0);
    expect(pcm[650 * 8]).toBe(mulawToPcm(SOFT));
  });

  it("writes to disk as the call goes, keeping the header current, and a crash-cut file is repaired to play", () => {
    const path = join(dir, "c-4.wav");
    const recorder = createCallRecorder(path);
    for (let at = 0; at < 3_000; at += 20) recorder.inbound(at, tone(LOUD, 20));
    const written = statSync(path).size;
    expect(written).toBeGreaterThan(44 + 1_500 * 8 * 2);
    expect(readFileSync(path).readUInt32LE(40)).toBe(written - 44);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.alloc(101)]));
    expect(repairRecording(path)).toEqual({ path, bytes: written + 100, seconds: Math.round((written + 100 - 44) / 2 / 8_000) });
    expect(readFileSync(path).readUInt32LE(40)).toBe(written + 100 - 44);
    expect(repairRecording(join(dir, "missing.wav"))).toBeNull();
    writeFileSync(join(dir, "junk.wav"), "not a wav file at all, just text that is long enough to pass the size check");
    expect(repairRecording(join(dir, "junk.wav"))).toBeNull();
    recorder.finish();
  });

  it("ignores audio after it was finished, and finishing twice is harmless", () => {
    const path = join(dir, "c-5.wav");
    const recorder = createCallRecorder(path);
    recorder.inbound(0, tone(LOUD, 10));
    const first = recorder.finish();
    recorder.inbound(10, tone(LOUD, 10));
    expect(recorder.finish()).toBe(first);
    expect(samples(path).length).toBe(80);
  });
});
