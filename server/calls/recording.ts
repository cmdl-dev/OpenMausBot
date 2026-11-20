// A call's recording, written while the call runs: the callee's audio and the voice's audio, both 8 kHz μ-law from
// the media stream, placed on one timeline, mixed and written as a 16-bit PCM WAV. The header is kept current after
// every write, so a file cut short by a crash still plays up to its last write.
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export const SAMPLE_RATE = 8_000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1_000;
const HEADER_BYTES = 44;
/** Audio is mixed and written once it is this far behind the newest audio heard, so the voice's queued reply can still
 * be cut where the callee talked over it. */
const WRITE_LAG_MS = 1_000;

/** G.711 μ-law byte to linear 16-bit sample. */
const MULAW = Int16Array.from({ length: 256 }, (_, index) => {
  const value = ~index & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
});

export function mulawToPcm(byte: number): number {
  return MULAW[byte & 0xff]!;
}

/** A 44-byte RIFF/WAVE header for mono 16-bit PCM at 8 kHz holding `dataBytes` of samples. */
export function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export interface RecordingResult {
  path: string;
  bytes: number;
  seconds: number;
}

export interface CallRecorder {
  /** The callee's audio, `atMs` from the start of the stream. */
  inbound(atMs: number, mulaw: Buffer): void;
  /** The voice's audio, sent to Twilio at `atMs`: it plays once the audio queued before it has played. */
  outbound(atMs: number, mulaw: Buffer): void;
  /** Twilio dropped every queued voice audio at `atMs`: nothing of the voice from then on was heard. */
  clearOutbound(atMs: number): void;
  /** Writes what is left and closes the file. Safe to call twice. */
  finish(): RecordingResult;
}

/** Starts the recording at `path` (the folder 700, the file 600). */
export function createCallRecorder(path: string): CallRecorder {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "w", 0o600);
  writeSync(fd, wavHeader(0), 0, HEADER_BYTES, 0);
  let base = 0;
  let callee = new Int16Array(SAMPLE_RATE * 4);
  let voice = new Int16Array(SAMPLE_RATE * 4);
  let voiceCursor = 0;
  let calleeEnd = 0;
  let dataBytes = 0;
  const end = () => Math.max(calleeEnd, voiceCursor);
  let finished: RecordingResult | null = null;

  const ensure = (sampleEnd: number) => {
    const needed = sampleEnd - base;
    if (needed <= callee.length) return;
    let size = callee.length;
    while (size < needed) size *= 2;
    const grownCallee = new Int16Array(size);
    grownCallee.set(callee);
    callee = grownCallee;
    const grownVoice = new Int16Array(size);
    grownVoice.set(voice);
    voice = grownVoice;
  };

  function write(upTo: number): void {
    const count = Math.min(upTo, end()) - base;
    if (count <= 0) return;
    const out = Buffer.alloc(count * 2);
    for (let index = 0; index < count; index++) {
      out.writeInt16LE(Math.max(-32_768, Math.min(32_767, callee[index]! + voice[index]!)), index * 2);
    }
    writeSync(fd, out, 0, out.length, HEADER_BYTES + dataBytes);
    dataBytes += out.length;
    const header = wavHeader(dataBytes);
    writeSync(fd, header, 4, 4, 4);
    writeSync(fd, header, 40, 4, 40);
    callee.copyWithin(0, count);
    callee.fill(0, callee.length - count);
    voice.copyWithin(0, count);
    voice.fill(0, voice.length - count);
    base += count;
  }

  function place(into: () => Int16Array, start: number, mulaw: Buffer): number {
    const from = Math.max(start, base);
    const skip = from - start;
    const stop = start + mulaw.length;
    if (stop <= from) return start;
    ensure(stop);
    const target = into();
    for (let index = skip; index < mulaw.length; index++) target[start + index - base] = mulawToPcm(mulaw[index]!);
    return stop;
  }

  return {
    inbound(atMs, mulaw) {
      if (finished) return;
      const start = Math.max(0, Math.round(atMs * SAMPLES_PER_MS));
      calleeEnd = Math.max(calleeEnd, place(() => callee, start, mulaw));
      write(start - WRITE_LAG_MS * SAMPLES_PER_MS);
    },
    outbound(atMs, mulaw) {
      if (finished) return;
      const start = Math.max(Math.round(atMs * SAMPLES_PER_MS), voiceCursor, base);
      voiceCursor = place(() => voice, start, mulaw);
    },
    clearOutbound(atMs) {
      if (finished) return;
      const cut = Math.max(Math.round(atMs * SAMPLES_PER_MS), base);
      if (cut - base < voice.length) voice.fill(0, cut - base);
      voiceCursor = Math.min(voiceCursor, cut);
    },
    finish() {
      if (finished) return finished;
      write(end());
      closeSync(fd);
      finished = { path, bytes: HEADER_BYTES + dataBytes, seconds: Math.round(dataBytes / 2 / SAMPLE_RATE) };
      return finished;
    },
  };
}

/** A recording left by a crash: its header's sizes set from the file's real length. Returns what it now holds, or null
 * when there is no usable file. */
export function repairRecording(path: string): RecordingResult | null {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  if (size < HEADER_BYTES) return null;
  const fd = openSync(path, "r+");
  try {
    const head = Buffer.alloc(12);
    readSync(fd, head, 0, 12, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    const dataBytes = (size - HEADER_BYTES) - ((size - HEADER_BYTES) % 2);
    const header = wavHeader(dataBytes);
    writeSync(fd, header, 4, 4, 4);
    writeSync(fd, header, 40, 4, 40);
    return { path, bytes: HEADER_BYTES + dataBytes, seconds: Math.round(dataBytes / 2 / SAMPLE_RATE) };
  } finally {
    closeSync(fd);
  }
}
