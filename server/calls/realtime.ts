// One answered call's audio: Twilio Media Streams (8 kHz μ-law, both ways) bridged to an OpenAI Realtime session.
// Twilio message shapes: https://www.twilio.com/docs/voice/media-streams/websocket-messages
// Realtime events: https://developers.openai.com/api/reference/resources/realtime
import WebSocket from "ws";
import type { CallLine } from "../../shared/phone-calls.ts";

const OPENAI_REALTIME = "wss://api.openai.com/v1/realtime";
const EARLY_AUDIO_CHUNKS = 250;
const GOODBYE_WAIT_MS = 10_000;

/** Only a loopback ws URL is accepted, so a test or fixture can stand in for OpenAI; never a remote host. */
export function realtimeUrl(model: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMB_CALLS_REALTIME_URL?.trim() ?? "";
  const base = /^ws:\/\/127\.0\.0\.1:\d{1,5}(\/[\w/-]*)?$/.test(override) ? override : OPENAI_REALTIME;
  return `${base}?model=${encodeURIComponent(model)}`;
}

export const END_CALL_TOOL = {
  type: "function",
  name: "end_call",
  description: "Hang up. Call it only after you have said goodbye, when the goal is done, the person asks to end the call, or the call can't go anywhere.",
  parameters: { type: "object", additionalProperties: false, properties: { reason: { type: "string", description: "Why, in a few words." } } },
};

export interface RealtimeSession {
  model: string;
  voice: string;
  transcriptionModel: string;
  instructions: string;
  /** What the voice is asked to say first, after the disclosure Twilio already spoke. */
  opening: string;
}

export interface BridgeEvents {
  /** Twilio's stream started: its ids. */
  started(ids: { streamSid: string; providerCallId?: string }): void;
  line(line: CallLine): void;
  /** The voice called end_call and its last words have played. */
  hangUp(reason: string): void;
  /** The voice can't go on (Realtime refused or dropped): the call should end. */
  failed(detail: string): void;
  /** Twilio's stream closed. */
  closed(): void;
  log(line: string): void;
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

/** Errors Realtime sends that leave the session usable. */
const HARMLESS_ERRORS = new Set(["conversation_already_has_active_response", "response_cancel_not_active", "item_truncate_invalid_item_id"]);

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
  const early: string[] = [];
  let latestMediaMs = 0;
  let speakingItem: string | null = null;
  let speakingFrom = 0;
  const marks: string[] = [];
  const startedAt = new Map<string, number>();
  let ending: { reason: string; timer: NodeJS.Timeout } | null = null;

  const toRealtime = (event: Json) => {
    if (realtime.readyState === WebSocket.OPEN) realtime.send(JSON.stringify(event));
  };
  const toTwilio = (event: Json) => {
    if (twilio.readyState === WebSocket.OPEN && streamSid) twilio.send(JSON.stringify({ ...event, streamSid }));
  };

  function finishEnding(): void {
    if (!ending) return;
    clearTimeout(ending.timer);
    const { reason } = ending;
    ending = null;
    events.hangUp(reason);
  }

  function interrupt(): void {
    if (speakingItem && marks.length) {
      toRealtime({ type: "conversation.item.truncate", item_id: speakingItem, content_index: 0, audio_end_ms: Math.max(0, latestMediaMs - speakingFrom) });
      toTwilio({ event: "clear" });
    }
    marks.length = 0;
    speakingItem = null;
  }

  function onRealtime(event: Json): void {
    switch (event.type) {
      case "session.updated":
        if (ready) return;
        ready = true;
        for (const audio of early.splice(0)) toRealtime({ type: "input_audio_buffer.append", audio });
        toRealtime({ type: "response.create", response: { instructions: session.opening } });
        return;
      case "response.output_audio.delta": {
        const item = text(event.item_id);
        if (item && item !== speakingItem) {
          speakingItem = item;
          speakingFrom = latestMediaMs;
          if (!startedAt.has(item)) startedAt.set(item, now());
        }
        toTwilio({ event: "media", media: { payload: text(event.delta) } });
        const mark = `${item}:${marks.length}`;
        marks.push(mark);
        toTwilio({ event: "mark", mark: { name: mark } });
        return;
      }
      case "input_audio_buffer.speech_started":
        if (typeof event.item_id === "string") startedAt.set(event.item_id, now());
        interrupt();
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const said = text(event.transcript).trim();
        if (said) events.line({ speaker: "callee", text: said, at: startedAt.get(text(event.item_id)) ?? now() });
        return;
      }
      case "response.output_audio_transcript.done": {
        const said = text(event.transcript).trim();
        if (said) events.line({ speaker: "bot", text: said, at: startedAt.get(text(event.item_id)) ?? now() });
        return;
      }
      case "response.function_call_arguments.done": {
        if (event.name !== "end_call" || ending) return;
        let reason = "";
        try {
          reason = text(field(JSON.parse(text(event.arguments) || "{}"), "reason"));
        } catch { /* no reason given */ }
        ending = { reason: reason.slice(0, 200), timer: setTimeout(finishEnding, GOODBYE_WAIT_MS) };
        if (!marks.length) finishEnding();
        else toTwilio({ event: "mark", mark: { name: "goodbye" } });
        return;
      }
      case "error": {
        const code = text(field(event.error, "code"));
        const message = text(field(event.error, "message")).slice(0, 300);
        events.log(`realtime error ${code || "?"}: ${message}`);
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
        const providerCallId = text(field(event.start, "callSid"));
        events.started({ streamSid, ...(providerCallId ? { providerCallId } : {}) });
        return;
      }
      case "media": {
        const media = event.media;
        if (field(media, "track") && field(media, "track") !== "inbound") return;
        const at = Number(field(media, "timestamp"));
        if (Number.isFinite(at)) latestMediaMs = at;
        const payload = text(field(media, "payload"));
        if (!payload) return;
        if (ready) toRealtime({ type: "input_audio_buffer.append", audio: payload });
        else if (early.length < EARLY_AUDIO_CHUNKS) early.push(payload);
        return;
      }
      case "mark": {
        const name = text(field(event.mark, "name"));
        if (name === "goodbye") return finishEnding();
        const at = marks.indexOf(name);
        if (at >= 0) marks.splice(0, at + 1);
        if (ending && !marks.length) finishEnding();
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
    if (realtime.readyState === WebSocket.OPEN || realtime.readyState === WebSocket.CONNECTING) realtime.close();
    if (twilio.readyState === WebSocket.OPEN) twilio.close();
    events.closed();
  }

  realtime.on("open", () => {
    toRealtime({
      type: "session.update",
      session: {
        type: "realtime",
        model: session.model,
        output_modalities: ["audio"],
        instructions: session.instructions,
        audio: {
          input: { format: { type: "audio/pcmu" }, transcription: { model: session.transcriptionModel }, turn_detection: { type: "server_vad" } },
          output: { format: { type: "audio/pcmu" }, voice: session.voice },
        },
        tools: [END_CALL_TOOL],
        tool_choice: "auto",
      },
    });
  });
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
      toRealtime({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: instruction }] } });
      toRealtime({ type: "response.create" });
    },
    close,
  };
}
