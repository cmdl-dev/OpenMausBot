import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import type { CallLine } from "../../shared/phone-calls.ts";
import { bridgeCall, realtimeSession, type BridgeEvents } from "./realtime.ts";

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  sent: Array<Record<string, unknown>> = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1000);
  }
  receive(event: Record<string, unknown>): void { this.emit("message", Buffer.from(JSON.stringify(event))); }
  of(type: string, key = "type") { return this.sent.filter((event) => event[key] === type); }
}

const SESSION = realtimeSession({
  model: "gpt-realtime-2.1-mini", voice: "marin", transcriptionModel: "gpt-transcribe",
  turnDetection: { type: "server_vad", threshold: 0.6, prefixPaddingMs: 300, silenceDurationMs: 700 }, noiseReduction: "near_field",
  instructions: "INSTRUCTIONS", endCallDescription: "Hang up.",
});

function call(maxTurnsWithoutReply = 3) {
  const twilio = new FakeSocket();
  const realtime = new FakeSocket();
  const lines: CallLine[] = [];
  const hangUps: string[] = [];
  const debug: string[] = [];
  let clock = 1_000;
  const events: BridgeEvents = {
    started: () => {}, line: (line) => void lines.push(line), hangUp: (reason) => void hangUps.push(reason), failed: () => {}, closed: () => {}, log: () => {},
    debug: (type) => void debug.push(type),
  };
  const bridge = bridgeCall(twilio as unknown as WebSocket, () => realtime as unknown as WebSocket,
    { session: SESSION, opening: "OPENING", goodbye: "GOODBYE", maxTurnsWithoutReply }, events, () => clock);
  twilio.receive({ event: "start", streamSid: "MZ1", start: { streamSid: "MZ1", callSid: "CA1" } });
  realtime.emit("open");
  const media = (payload: string) => twilio.receive({ event: "media", media: { track: "inbound", payload } });
  const ready = () => realtime.receive({ type: "session.updated" });
  let response = 0;
  const turn = (opts: { audioBytes?: number } = {}) => {
    const id = `resp_${++response}`;
    const item = `item_${response}`;
    realtime.receive({ type: "response.created", response: { id } });
    if (opts.audioBytes) realtime.receive({ type: "response.output_audio.delta", item_id: item, delta: Buffer.alloc(opts.audioBytes).toString("base64") });
    realtime.receive({ type: "response.output_audio.done", item_id: item });
    realtime.receive({ type: "response.output_audio_transcript.done", item_id: item, transcript: `bot line ${response}` });
    realtime.receive({ type: "response.done", response: { id, status: "completed" } });
    return { id, item };
  };
  const heard = (transcript: string, item = "in_1") => realtime.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: item, transcript });
  return { twilio, realtime, lines, hangUps, debug, bridge, media, ready, turn, heard, tick: (ms: number) => { clock += ms; } };
}

describe("the call's voice", () => {
  it("sends the whole saved session, then the opening exactly once, without the audio heard before the voice was ready", () => {
    const c = call();
    expect(c.realtime.sent[0]).toEqual({ type: "session.update", session: SESSION });
    expect(SESSION).toMatchObject({ audio: { input: { turn_detection: { type: "server_vad", threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 700, create_response: true, interrupt_response: true }, noise_reduction: { type: "near_field" } } } });
    c.media("EARLY1");
    c.media("EARLY2");
    c.ready();
    c.ready();
    expect(c.realtime.of("input_audio_buffer.append")).toEqual([]);
    expect(c.realtime.of("response.create")).toEqual([{ type: "response.create", response: { instructions: "OPENING" } }]);
    const types = c.realtime.sent.map((event) => event.type);
    expect(types.indexOf("input_audio_buffer.clear")).toBeLessThan(types.indexOf("response.create"));
    c.media("LATER");
    expect(c.realtime.of("input_audio_buffer.append")).toEqual([{ type: "input_audio_buffer.append", audio: "LATER" }]);
  });

  it("cancels a second response that starts while one is running", () => {
    const c = call();
    c.ready();
    c.realtime.receive({ type: "response.created", response: { id: "resp_a" } });
    c.realtime.receive({ type: "response.created", response: { id: "resp_b" } });
    expect(c.realtime.of("response.cancel")).toEqual([{ type: "response.cancel", response_id: "resp_b" }]);
  });

  it("says goodbye and hangs up after the set number of turns with nothing from the callee", () => {
    const c = call(3);
    c.ready();
    c.turn();
    c.heard("…");
    c.turn();
    expect(c.realtime.of("response.create")).toHaveLength(1);
    c.turn();
    expect(c.realtime.of("response.create").at(-1)).toEqual({ type: "response.create", response: { instructions: "GOODBYE", tool_choice: "none" } });
    c.realtime.receive({ type: "response.created", response: { id: "bye" } });
    c.realtime.receive({ type: "response.output_audio.delta", item_id: "bye_item", delta: Buffer.alloc(800).toString("base64") });
    c.realtime.receive({ type: "response.created", response: { id: "noise" } });
    expect(c.realtime.of("response.cancel").at(-1)).toEqual({ type: "response.cancel", response_id: "noise" });
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_9" });
    expect(c.twilio.of("clear", "event")).toEqual([]);
    c.realtime.receive({ type: "response.done", response: { id: "bye", status: "completed" } });
    expect(c.hangUps).toEqual([]);
    const pending = c.twilio.of("mark", "event").map((event) => (event.mark as { name: string }).name);
    expect(pending.at(-1)).toBe("goodbye");
    c.twilio.receive({ event: "mark", mark: { name: "goodbye" } });
    expect(c.hangUps).toEqual(["no_reply"]);
    expect(c.debug).toContain("loop_guard");
  });

  it("starts counting again whenever the callee says something", () => {
    const c = call(3);
    c.ready();
    c.turn();
    c.turn();
    c.heard("Yes, that works.");
    c.turn();
    c.turn();
    expect(c.realtime.of("response.create")).toHaveLength(1);
    expect(c.lines.filter((line) => line.speaker === "callee").map((line) => line.text)).toEqual(["Yes, that works."]);
  });

  it("on barge-in, clears Twilio and truncates the reply at what was actually played, never past what was sent", () => {
    const c = call();
    c.ready();
    c.realtime.receive({ type: "response.created", response: { id: "r1" } });
    for (let chunk = 0; chunk < 4; chunk++) c.realtime.receive({ type: "response.output_audio.delta", item_id: "item_1", delta: Buffer.alloc(2_000).toString("base64") });
    const marks = c.twilio.of("mark", "event").map((event) => (event.mark as { name: string }).name);
    expect(marks).toHaveLength(4);
    c.twilio.receive({ event: "mark", mark: { name: marks[1] } });
    c.realtime.receive({ type: "response.output_audio_transcript.done", item_id: "item_1", transcript: "Hello, I'm calling about your order from last week." });
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_1" });
    expect(c.realtime.of("conversation.item.truncate")).toEqual([{ type: "conversation.item.truncate", item_id: "item_1", content_index: 0, audio_end_ms: 500 }]);
    expect(c.twilio.of("clear", "event")).toEqual([{ event: "clear", streamSid: "MZ1" }]);
    expect(c.lines).toEqual([{ speaker: "bot", text: "Hello, I'm calling about your order from last week.", at: 1_000, cut: true }]);
    for (const name of marks) c.twilio.receive({ event: "mark", mark: { name } });
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_2" });
    expect(c.realtime.of("conversation.item.truncate")).toHaveLength(1);
  });

  it("truncates at zero when none of the reply has played yet", () => {
    const c = call();
    c.ready();
    c.realtime.receive({ type: "response.output_audio.delta", item_id: "item_1", delta: Buffer.alloc(16_000).toString("base64") });
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_1" });
    expect(c.realtime.of("conversation.item.truncate")).toEqual([expect.objectContaining({ audio_end_ms: 0 })]);
  });

  it("writes a bot line once its audio has played, uncut", () => {
    const c = call();
    c.ready();
    c.realtime.receive({ type: "response.output_audio.delta", item_id: "item_1", delta: Buffer.alloc(800).toString("base64") });
    c.realtime.receive({ type: "response.output_audio.done", item_id: "item_1" });
    c.realtime.receive({ type: "response.output_audio_transcript.done", item_id: "item_1", transcript: "Thanks, goodbye!" });
    expect(c.lines).toEqual([]);
    const [mark] = c.twilio.of("mark", "event").map((event) => (event.mark as { name: string }).name);
    c.twilio.receive({ event: "mark", mark: { name: mark } });
    expect(c.lines).toEqual([{ speaker: "bot", text: "Thanks, goodbye!", at: 1_000 }]);
  });

  it("queues the wrap-up behind a running response instead of starting a second one", () => {
    const c = call();
    c.ready();
    c.realtime.receive({ type: "response.created", response: { id: "r1" } });
    c.bridge.wrapUp("WRAP UP");
    expect(c.realtime.of("conversation.item.create")).toHaveLength(1);
    expect(c.realtime.of("response.create")).toHaveLength(1);
    c.realtime.receive({ type: "response.done", response: { id: "r1", status: "completed" } });
    expect(c.realtime.of("response.create")).toHaveLength(2);
  });
});
