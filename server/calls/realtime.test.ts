import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import type { CallLine } from "../../shared/phone-calls.ts";
import { bridgeCall, openingSessions, realtimeSession, reasoningModel, type BridgeEvents } from "./realtime.ts";

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
  instructions: "INSTRUCTIONS", endCallDescription: "Hang up.", reasoningEffort: "low",
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
    { session: SESSION, opening: "OPENING", goodbye: "GOODBYE", closing: "CLOSING", maxTurnsWithoutReply }, events, () => clock);
  twilio.receive({ event: "start", streamSid: "MZ1", start: { streamSid: "MZ1", callSid: "CA1" } });
  realtime.emit("open");
  const media = (payload: string) => twilio.receive({ event: "media", media: { track: "inbound", payload } });
  const ready = () => realtime.receive({ type: "session.updated" });
  let response = 0;
  const turn = (opts: { audioBytes?: number } = {}) => {
    const id = `resp_${++response}`;
    const item = `item_${response}`;
    realtime.receive({ type: "response.created", response: { id } });
    if (opts.audioBytes) realtime.receive({ type: "response.output_audio.delta", response_id: id, item_id: item, delta: Buffer.alloc(opts.audioBytes).toString("base64") });
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

  it("counts a reply to the callee's words as the first of a new run, even when the transcript arrives after the reply starts", () => {
    const c = call(3);
    c.ready();
    c.turn();
    c.turn();
    c.realtime.receive({ type: "input_audio_buffer.committed", item_id: "in_1" });
    c.turn();
    expect(c.realtime.of("response.create")).toHaveLength(1);
    c.heard("I'm good, thank you.", "in_1");
    c.turn();
    expect(c.realtime.of("response.create")).toHaveLength(1);
    expect(c.debug).not.toContain("loop_guard");
    c.turn();
    expect(c.realtime.of("response.create").at(-1)).toEqual({ type: "response.create", response: { instructions: "GOODBYE", tool_choice: "none" } });
  });

  it("counts replies to audio that turned out to be no words once that is known", () => {
    const c = call(3);
    c.ready();
    c.turn();
    c.realtime.receive({ type: "input_audio_buffer.committed", item_id: "noise_1" });
    c.turn();
    c.turn();
    expect(c.debug).not.toContain("loop_guard");
    c.realtime.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "noise_1", transcript: "" });
    expect(c.realtime.of("response.create").at(-1)).toEqual({ type: "response.create", response: { instructions: "GOODBYE", tool_choice: "none" } });
  });

  it("makes the voice say goodbye before hanging up when it calls end_call without one, and hangs up once that has played", () => {
    const c = call();
    c.ready();
    c.turn({ audioBytes: 800 });
    c.heard("I'm good, thank you.");
    c.realtime.receive({ type: "response.created", response: { id: "abrupt" } });
    c.realtime.receive({ type: "response.function_call_arguments.done", response_id: "abrupt", call_id: "fc_1", name: "end_call", arguments: "{}" });
    expect(c.realtime.of("conversation.item.create")).toEqual([{ type: "conversation.item.create", item: { type: "function_call_output", call_id: "fc_1", output: "Not hung up yet: say goodbye first." } }]);
    expect(c.realtime.of("response.create")).toHaveLength(1);
    c.realtime.receive({ type: "response.done", response: { id: "abrupt", status: "completed" } });
    expect(c.realtime.of("response.create").at(-1)).toEqual({ type: "response.create", response: { instructions: "CLOSING", tool_choice: "none" } });
    expect(c.hangUps).toEqual([]);
    c.realtime.receive({ type: "response.created", response: { id: "bye" } });
    c.realtime.receive({ type: "response.output_audio.delta", response_id: "bye", item_id: "bye_item", delta: Buffer.alloc(800).toString("base64") });
    c.realtime.receive({ type: "response.output_audio_transcript.done", item_id: "bye_item", transcript: "Thanks so much, have a great day. Bye!" });
    c.realtime.receive({ type: "response.done", response: { id: "bye", status: "completed" } });
    expect(c.hangUps).toEqual([]);
    c.twilio.receive({ event: "mark", mark: { name: "goodbye" } });
    expect(c.hangUps).toEqual(["completed"]);
    expect(c.debug).toContain("end_call_without_goodbye");
  });

  it("hangs up straight after end_call when the voice said goodbye in that response or just before it", () => {
    const same = call();
    same.ready();
    same.realtime.receive({ type: "response.created", response: { id: "r1" } });
    same.realtime.receive({ type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: Buffer.alloc(80).toString("base64") });
    same.realtime.receive({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "fc", name: "end_call", arguments: "{}" });
    same.twilio.receive({ event: "mark", mark: { name: "goodbye" } });
    expect(same.hangUps).toEqual(["completed"]);
    expect(same.realtime.of("conversation.item.create")).toEqual([]);

    const before = call();
    before.ready();
    before.realtime.receive({ type: "response.created", response: { id: "r1" } });
    before.realtime.receive({ type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: Buffer.alloc(80).toString("base64") });
    before.realtime.receive({ type: "response.output_audio_transcript.done", item_id: "i1", transcript: "Okay, take care!" });
    before.realtime.receive({ type: "response.done", response: { id: "r1", status: "completed" } });
    before.realtime.receive({ type: "response.created", response: { id: "r2" } });
    before.realtime.receive({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "fc", name: "end_call", arguments: "{}" });
    expect(before.realtime.of("conversation.item.create")).toEqual([]);
  });
});

describe("the session sent to OpenAI", () => {
  const base = { model: "gpt-realtime-2.1-mini", voice: "cedar", transcriptionModel: "gpt-transcribe", noiseReduction: "near_field" as const, instructions: "I", endCallDescription: "E" };

  it("uses semantic VAD with its eagerness, and the reasoning effort for a reasoning model", () => {
    const session = realtimeSession({ ...base, turnDetection: { type: "semantic_vad", eagerness: "auto" }, reasoningEffort: "low" });
    expect(session).toMatchObject({
      model: "gpt-realtime-2.1-mini", reasoning: { effort: "low" },
      audio: { input: { turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true }, noise_reduction: { type: "near_field" } }, output: { voice: "cedar", format: { type: "audio/pcmu" } } },
    });
    expect((session.audio as { input: { turn_detection: Record<string, unknown> } }).input.turn_detection).not.toHaveProperty("threshold");
  });

  it("uses server VAD with its numbers when chosen, and sends no reasoning to a model that doesn't reason", () => {
    const session = realtimeSession({ ...base, model: "gpt-realtime-1.5", turnDetection: { type: "server_vad", threshold: 0.7, prefixPaddingMs: 200, silenceDurationMs: 900 }, reasoningEffort: "medium" });
    expect((session.audio as { input: { turn_detection: unknown } }).input.turn_detection).toEqual({ type: "server_vad", threshold: 0.7, prefix_padding_ms: 200, silence_duration_ms: 900, create_response: true, interrupt_response: true });
    expect(session).not.toHaveProperty("reasoning");
    expect(["gpt-realtime-2", "gpt-realtime-2.1", "gpt-realtime-2.1-mini", "gpt-realtime-3-preview"].every(reasoningModel)).toBe(true);
    expect(["gpt-realtime", "gpt-realtime-1.5", "gpt-realtime-mini", "gpt-4o-realtime-preview"].some(reasoningModel)).toBe(false);
  });
});

describe("the opening, with the stream starting the moment the callee answers", () => {
  function opened() {
    const twilio = new FakeSocket();
    const realtime = new FakeSocket();
    const lines: CallLine[] = [];
    const debug: string[] = [];
    const split = openingSessions(SESSION);
    bridgeCall(twilio as unknown as WebSocket, () => realtime as unknown as WebSocket, {
      session: split.session, afterOpening: split.afterOpening, opening: "OPENING", goodbye: "GOODBYE", closing: "CLOSING", maxTurnsWithoutReply: 3,
    }, {
      started: () => {}, line: (line) => void lines.push(line), hangUp: () => {}, failed: () => {}, closed: () => {}, log: () => {}, debug: (type) => void debug.push(type),
    }, () => 1_000);
    twilio.receive({ event: "start", streamSid: "MZ1", start: { streamSid: "MZ1", callSid: "CA1" } });
    realtime.emit("open");
    return { twilio, realtime, lines, debug, split };
  }

  it("holds replies and interruptions back until the opening is said, then turns them on as configured", () => {
    const { split } = opened();
    expect((split.session.audio as { input: { turn_detection: unknown } }).input.turn_detection).toEqual({
      type: "server_vad", threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 700, create_response: false, interrupt_response: false,
    });
    expect(split.afterOpening).toEqual({ type: "realtime", audio: { input: { turn_detection: (SESSION.audio as { input: { turn_detection: unknown } }).input.turn_detection } } });
  });

  it("drops the callee's \"Hello?\" from before the voice is ready, says the opening once, and doesn't greet again or get cut off by it", () => {
    const c = opened();
    expect(c.realtime.sent[0]).toEqual({ type: "session.update", session: c.split.session });
    c.twilio.receive({ event: "media", media: { track: "inbound", payload: "SEVMTE8/" } });
    c.realtime.receive({ type: "session.updated" });
    expect(c.realtime.of("input_audio_buffer.append")).toEqual([]);
    expect(c.realtime.of("input_audio_buffer.clear")).toHaveLength(1);
    c.realtime.receive({ type: "response.created", response: { id: "opening" } });
    c.realtime.receive({ type: "response.output_audio.delta", response_id: "opening", item_id: "o1", delta: Buffer.alloc(1_600).toString("base64") });
    c.twilio.receive({ event: "media", media: { track: "inbound", payload: "SEVMTE8/" } });
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_1" });
    c.realtime.receive({ type: "input_audio_buffer.committed", item_id: "in_1" });
    c.realtime.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "in_1", transcript: "Hello?" });
    expect(c.twilio.of("clear", "event")).toEqual([]);
    expect(c.realtime.of("conversation.item.truncate")).toEqual([]);
    c.realtime.receive({ type: "session.updated" });
    c.realtime.receive({ type: "response.output_audio_transcript.done", item_id: "o1", transcript: "Hi, I'm calling for GrandStein to ask how your day is going." });
    c.realtime.receive({ type: "response.done", response: { id: "opening", status: "completed" } });
    expect(c.realtime.of("response.create")).toEqual([{ type: "response.create", response: { instructions: "OPENING" } }]);
    expect(c.realtime.of("session.update")).toEqual([
      { type: "session.update", session: c.split.session },
      { type: "session.update", session: c.split.afterOpening },
    ]);
    c.realtime.receive({ type: "session.updated" });
    expect(c.realtime.of("response.create")).toHaveLength(1);
    expect(c.lines.map((line) => line.speaker)).toEqual(["callee"]);
    c.realtime.receive({ type: "input_audio_buffer.speech_started", item_id: "in_2" });
    expect(c.twilio.of("clear", "event")).toHaveLength(1);
    expect(c.debug).toContain("replies_on");
  });
});
