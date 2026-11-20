// One answered call's audio: Twilio Media Streams (8 kHz μ-law, both ways) bridged to an OpenAI Realtime session.
// Twilio message shapes: https://www.twilio.com/docs/voice/media-streams/websocket-messages
// Realtime events: https://developers.openai.com/api/reference/resources/realtime
// Twilio sends a mark back once the audio queued before it has played, and sends every pending mark back on `clear`.
import WebSocket from "ws";
import type { CallLine, CallNoiseReduction, CallTurnDetection } from "../../shared/phone-calls.ts";
import type { CallRecorder } from "./recording.ts";

const OPENAI_REALTIME = "wss://api.openai.com/v1/realtime";
const GOODBYE_WAIT_MS = 10_000;
/** 8 kHz μ-law: one byte per sample. */
const MULAW_BYTES_PER_MS = 8;

/** Only a loopback ws URL is accepted, so a test or fixture can stand in for OpenAI; never a remote host. */
export function realtimeUrl(model: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMB_CALLS_REALTIME_URL?.trim() ?? "";
  const base = /^ws:\/\/127\.0\.0\.1:\d{1,5}(\/[\w/-]*)?$/.test(override) ? override : OPENAI_REALTIME;
  return `${base}?model=${encodeURIComponent(model)}`;
}

export function endCallTool(description: string): Record<string, unknown> {
  return {
    type: "function",
    name: "end_call",
    description,
    parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string", description: "Why, in a few words." } } },
  };
}

function turnDetection(settings: CallTurnDetection): Record<string, unknown> {
  const common = { type: settings.type, create_response: true, interrupt_response: true };
  if (settings.type === "semantic_vad") return { ...common, ...(settings.eagerness ? { eagerness: settings.eagerness } : {}) };
  return {
    ...common,
    ...(settings.threshold !== undefined ? { threshold: settings.threshold } : {}),
    ...(settings.prefixPaddingMs !== undefined ? { prefix_padding_ms: settings.prefixPaddingMs } : {}),
    ...(settings.silenceDurationMs !== undefined ? { silence_duration_ms: settings.silenceDurationMs } : {}),
  };
}

/** The whole `session` of the session.update that starts a call's voice. */
export function realtimeSession(input: {
  model: string; voice: string; transcriptionModel: string; turnDetection: CallTurnDetection; noiseReduction: CallNoiseReduction; instructions: string; endCallDescription: string;
}): Record<string, unknown> {
  return {
    type: "realtime",
    model: input.model,
    output_modalities: ["audio"],
    instructions: input.instructions,
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        transcription: { model: input.transcriptionModel },
        turn_detection: turnDetection(input.turnDetection),
        noise_reduction: input.noiseReduction === "off" ? null : { type: input.noiseReduction },
      },
      output: { format: { type: "audio/pcmu" }, voice: input.voice },
    },
    tools: [endCallTool(input.endCallDescription)],
    tool_choice: "auto",
  };
}

export interface RealtimeSession {
  /** Sent whole as the session.update. */
  session: Record<string, unknown>;
  /** The first response's instructions, sent once. */
  opening: string;
  /** Said when the voice has taken `maxTurnsWithoutReply` turns in a row with nothing from the callee; then it hangs up. */
  goodbye: string;
  maxTurnsWithoutReply: number;
  /** Records both sides of the call, when recording is on. */
  recorder?: CallRecorder;
}

export interface BridgeEvents {
  /** Twilio's stream started: its ids. */
  started(ids: { streamSid: string; providerCallId?: string }): void;
  line(line: CallLine): void;
  /** The voice is done and its last words have played: `completed` after end_call, `no_reply` after the loop guard's goodbye. */
  hangUp(reason: "completed" | "no_reply", why: string): void;
  /** The voice can't go on (Realtime refused or dropped): the call should end. */
  failed(detail: string): void;
  /** Twilio's stream closed. */
  closed(): void;
  log(line: string): void;
  /** One event worth keeping to diagnose a call: never audio, never a key. */
  debug(type: string, detail?: Record<string, string | number | boolean>): void;
}

type Json = Record<string, unknown>;

function parse(data: WebSocket.RawData): Json | null {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

const field = (value: unknown, key: string): unknown => (value && typeof value === "object" ? (value as Json)[key] : undefined);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
/** Words, not a cough or "…": letters or digits in any script. */
const spoken = (said: string) => /[\p{L}\p{N}]/u.test(said);

/** Errors Realtime sends that leave the session usable. */
const HARMLESS_ERRORS = new Set(["conversation_already_has_active_response", "response_cancel_not_active", "item_truncate_invalid_item_id", "invalid_value"]);

interface Spoken {
  sentBytes: number;
  playedBytes: number;
  audioDone: boolean;
  transcript?: string;
  at: number;
  cut: boolean;
  written: boolean;
}

export interface CallBridge {
  /** Asks the voice to wrap up now (time is nearly up). */
  wrapUp(instruction: string): void;
  close(): void;
}

/** Bridges `twilio` (the Media Streams socket Twilio opened) to a Realtime session opened with `openRealtime`. */
export function bridgeCall(twilio: WebSocket, openRealtime: () => WebSocket, session: RealtimeSession, events: BridgeEvents, now: () => number = Date.now): CallBridge {
  const realtime = openRealtime();
  let ready = false;
  let closed = false;
  let streamSid = "";
  let markSeq = 0;
  /** Marks sent to Twilio and not yet back, in order: which bot item each follows and its bytes through that point. */
  const marks = new Map<string, { item: string; through: number }>();
  const items = new Map<string, Spoken>();
  const calleeStarted = new Map<string, number>();
  let speaking: string | null = null;
  let activeResponse: string | null = null;
  let queuedResponse: Json | null = null;
  let turnsWithoutReply = 0;
  let goodbye: { responseId?: string } | null = null;
  let ending: { reason: "completed" | "no_reply"; why: string; timer: NodeJS.Timeout; done: boolean } | null = null;
  const { recorder } = session;
  let streamStart: number | null = null;
  const streamMs = () => (streamStart === null ? 0 : now() - streamStart);

  const toRealtime = (event: Json) => {
    if (realtime.readyState === WebSocket.OPEN) realtime.send(JSON.stringify(event));
  };
  const toTwilio = (event: Json) => {
    if (twilio.readyState === WebSocket.OPEN && streamSid) twilio.send(JSON.stringify({ ...event, streamSid }));
  };
  const pendingFor = (item: string) => [...marks.values()].some((mark) => mark.item === item);

  function write(id: string, force = false): void {
    const item = items.get(id);
    if (!item || item.written || item.transcript === undefined) return;
    if (!force && !item.cut && (!item.audioDone || pendingFor(id))) return;
    item.written = true;
    if (item.transcript) events.line({ speaker: "bot", text: item.transcript, at: item.at, ...(item.cut ? { cut: true as const } : {}) });
  }

  function respond(response: Json): void {
    if (activeResponse) queuedResponse = response;
    else toRealtime({ type: "response.create", response });
  }

  function startEnding(reason: "completed" | "no_reply", why: string): void {
    if (ending) return;
    ending = { reason, why, timer: setTimeout(finishEnding, GOODBYE_WAIT_MS), done: false };
    events.debug("ending", { reason });
    if (!marks.size) finishEnding();
    else toTwilio({ event: "mark", mark: { name: "goodbye" } });
  }

  function finishEnding(): void {
    if (!ending || ending.done) return;
    ending.done = true;
    clearTimeout(ending.timer);
    events.hangUp(ending.reason, ending.why);
  }

  /** The callee talked over the voice: stop its audio at once and tell Realtime how much of the reply was heard. */
  function interrupt(): void {
    const item = speaking ? items.get(speaking) : undefined;
    if (speaking && item && pendingFor(speaking)) {
      const heardMs = Math.min(Math.floor(item.playedBytes / MULAW_BYTES_PER_MS), Math.floor(item.sentBytes / MULAW_BYTES_PER_MS));
      toRealtime({ type: "conversation.item.truncate", item_id: speaking, content_index: 0, audio_end_ms: heardMs });
      item.cut = true;
      events.debug("truncate", { item: speaking, heardMs, sentMs: Math.floor(item.sentBytes / MULAW_BYTES_PER_MS) });
      write(speaking);
    }
    if (marks.size) {
      toTwilio({ event: "clear" });
      recorder?.clearOutbound(streamMs());
    }
    marks.clear();
    speaking = null;
  }

  function onRealtime(event: Json): void {
    switch (event.type) {
      case "session.updated":
        if (ready) return;
        ready = true;
        toRealtime({ type: "input_audio_buffer.clear" });
        respond({ instructions: session.opening });
        events.debug("opening_sent");
        return;
      case "response.created": {
        const id = text(field(event.response, "id"));
        if (activeResponse && activeResponse !== id) {
          toRealtime({ type: "response.cancel", response_id: id });
          events.debug("response_cancelled", { why: "another_active" });
          return;
        }
        if (goodbye && goodbye.responseId === undefined) goodbye.responseId = id;
        else if (goodbye || ending) {
          toRealtime({ type: "response.cancel", response_id: id });
          events.debug("response_cancelled", { why: "ending" });
          return;
        }
        activeResponse = id;
        turnsWithoutReply += 1;
        events.debug("response_created", { turnsWithoutReply });
        return;
      }
      case "response.done": {
        const id = text(field(event.response, "id"));
        events.debug("response_done", { status: text(field(event.response, "status")) || "?" });
        if (activeResponse === id) activeResponse = null;
        if (goodbye?.responseId === id) return startEnding("no_reply", "the callee didn't answer");
        if (!goodbye && !ending && turnsWithoutReply >= session.maxTurnsWithoutReply) {
          goodbye = {};
          queuedResponse = null;
          events.debug("loop_guard", { turnsWithoutReply });
          toRealtime({ type: "response.create", response: { instructions: session.goodbye, tool_choice: "none" } });
          return;
        }
        if (queuedResponse && !activeResponse) {
          const next = queuedResponse;
          queuedResponse = null;
          toRealtime({ type: "response.create", response: next });
        }
        return;
      }
      case "response.output_audio.delta": {
        const id = text(event.item_id);
        const delta = text(event.delta);
        if (!id || !delta) return;
        let item = items.get(id);
        if (!item) {
          item = { sentBytes: 0, playedBytes: 0, audioDone: false, at: now(), cut: false, written: false };
          items.set(id, item);
        }
        speaking = id;
        const audio = Buffer.from(delta, "base64");
        item.sentBytes += audio.length;
        toTwilio({ event: "media", media: { payload: delta } });
        recorder?.outbound(streamMs(), audio);
        const mark = `m${++markSeq}`;
        marks.set(mark, { item: id, through: item.sentBytes });
        toTwilio({ event: "mark", mark: { name: mark } });
        return;
      }
      case "response.output_audio.done": {
        const id = text(event.item_id);
        const item = items.get(id);
        if (item) item.audioDone = true;
        write(id);
        return;
      }
      case "response.output_audio_transcript.done": {
        const id = text(event.item_id);
        const item = items.get(id) ?? { sentBytes: 0, playedBytes: 0, audioDone: true, at: now(), cut: false, written: false };
        items.set(id, item);
        item.transcript = text(event.transcript).trim();
        write(id);
        return;
      }
      case "input_audio_buffer.speech_started":
        if (typeof event.item_id === "string") calleeStarted.set(event.item_id, now());
        events.debug("speech_started");
        if (!goodbye && !ending) interrupt();
        return;
      case "input_audio_buffer.speech_stopped":
        events.debug("speech_stopped");
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const said = text(event.transcript).trim();
        if (!spoken(said)) {
          events.debug("transcription_empty");
          return;
        }
        turnsWithoutReply = 0;
        events.line({ speaker: "callee", text: said, at: calleeStarted.get(text(event.item_id)) ?? now() });
        return;
      }
      case "conversation.item.input_audio_transcription.failed":
        events.debug("transcription_failed", { code: text(field(event.error, "code")) || "?" });
        return;
      case "response.function_call_arguments.done": {
        if (event.name !== "end_call" || ending) return;
        let why = "";
        try {
          why = text(field(JSON.parse(text(event.arguments) || "{}"), "reason"));
        } catch { /* no reason given */ }
        startEnding("completed", why.slice(0, 200));
        return;
      }
      case "error": {
        const code = text(field(event.error, "code"));
        const message = text(field(event.error, "message")).slice(0, 300);
        events.log(`realtime error ${code || "?"}: ${message}`);
        events.debug("realtime_error", { code: code || "?" });
        if (!ready && !HARMLESS_ERRORS.has(code)) events.failed(message || "The voice service refused the session.");
        return;
      }
      default:
        return;
    }
  }

  function onTwilio(event: Json): void {
    switch (event.event) {
      case "start": {
        streamSid = text(field(event.start, "streamSid")) || text(event.streamSid);
        streamStart ??= now();
        const providerCallId = text(field(event.start, "callSid"));
        events.started({ streamSid, ...(providerCallId ? { providerCallId } : {}) });
        return;
      }
      case "media": {
        const media = event.media;
        if (field(media, "track") && field(media, "track") !== "inbound") return;
        const payload = text(field(media, "payload"));
        if (!payload) return;
        if (recorder) {
          const at = Number(field(media, "timestamp"));
          recorder.inbound(Number.isFinite(at) ? at : streamMs(), Buffer.from(payload, "base64"));
        }
        if (ready) toRealtime({ type: "input_audio_buffer.append", audio: payload });
        return;
      }
      case "mark": {
        const name = text(field(event.mark, "name"));
        if (name === "goodbye") return finishEnding();
        const acked = marks.get(name);
        if (!acked) return;
        for (const key of marks.keys()) {
          marks.delete(key);
          if (key === name) break;
        }
        const item = items.get(acked.item);
        if (item) item.playedBytes = Math.max(item.playedBytes, acked.through);
        write(acked.item);
        if (ending && !marks.size) finishEnding();
        return;
      }
      case "stop":
        close();
        return;
      default:
        return;
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (ending) clearTimeout(ending.timer);
    for (const id of items.keys()) write(id, true);
    if (realtime.readyState === WebSocket.OPEN || realtime.readyState === WebSocket.CONNECTING) realtime.close();
    if (twilio.readyState === WebSocket.OPEN) twilio.close();
    events.closed();
  }

  realtime.on("open", () => toRealtime({ type: "session.update", session: session.session }));
  realtime.on("message", (data) => {
    const event = parse(data);
    if (event) onRealtime(event);
  });
  realtime.on("error", (error) => events.log(`realtime socket: ${error.message}`));
  realtime.on("close", (code) => {
    if (closed) return;
    events.failed(ready ? "The voice service closed the session." : `The voice service refused the session (${code}).`);
  });
  twilio.on("message", (data) => {
    const event = parse(data);
    if (event) onTwilio(event);
  });
  twilio.on("close", close);
  twilio.on("error", (error) => events.log(`twilio socket: ${error.message}`));

  return {
    wrapUp(instruction) {
      if (goodbye || ending) return;
      toRealtime({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: instruction }] } });
      respond({});
      events.debug("wrap_up");
    },
    close,
  };
}
