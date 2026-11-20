// Phone calls bots place: their records and transcripts on disk, what the provider's callbacks and the media stream do
// to them, the time limit, and the summary turn once a call ends.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type WebSocket from "ws";
import { numberRefusal, type CallDetail, type CallEndReason, type CallLine, type CallPhase, type CallSummary } from "../../shared/phone-calls.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { ReadyCalls } from "./config.ts";
import { disclosureLine, openingInstruction, summaryPrompt, voiceInstructions, WRAP_UP_INSTRUCTION } from "./prompt.ts";
import type { CallProvider, ProviderProgress } from "./provider.ts";
import { bridgeCall, type CallBridge } from "./realtime.ts";
import { connectStreamTwiml, hangUpTwiml } from "./twilio.ts";

export interface CallRecord {
  id: string;
  botId: string;
  botName: string;
  threadId: string;
  to: string;
  calleeName?: string;
  brief: string;
  onBehalfOf: string;
  provider: "twilio";
  providerCallId?: string;
  maxMinutes: number;
  phase: CallPhase;
  createdAt: number;
  answeredAt?: number;
  endedAt?: number;
  endReason?: CallEndReason;
  endDetail?: string;
  /** Set when OpenMausBot asked the provider to hang up: the reason the call ends with once it does. */
  hangingUp?: CallEndReason;
  lines: number;
  cardMessageId?: string;
  summary?: "asked" | "failed";
}

export interface CallDeps {
  dataDir: string;
  /** The settings a call is placed with, or why none can be. */
  settings(): ReadyCalls | { refusal: string };
  provider(settings: ReadyCalls): CallProvider;
  openRealtime(settings: ReadyCalls): WebSocket;
  card: { show(record: CallRecord): string | null; update(record: CallRecord): void };
  /** An outside-origin turn in the call's conversation (the summary). */
  followUp(record: CallRecord, prompt: string): Promise<void>;
  log(line: string): void;
  now?: () => number;
  /** How often a running call's progress is read from the provider when its callbacks are quiet. */
  watchdogMs?: number;
  /** How long ending waits for the provider to confirm a hang-up. */
  hangUpWaitMs?: number;
}

const FILE = "calls.json";
const KEEP_ENDED = 500;
const RING_SECONDS = 45;
const WRAP_UP_BEFORE_MS = 45_000;
const MAX_ACTIVE = 3;
const PATH = "/calls/twilio";

export class CallError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

const isEnded = (record: CallRecord) => record.phase === "ended";

interface Live {
  token: string;
  bridge?: CallBridge;
  timers: NodeJS.Timeout[];
  watchdog?: NodeJS.Timeout;
}

export function createCalls(deps: CallDeps) {
  const now = deps.now ?? Date.now;
  const folder = join(deps.dataDir, "calls");
  mkdirSync(folder, { recursive: true });
  const records = new Map<string, CallRecord>();
  const live = new Map<string, Live>();
  let closed = false;

  try {
    const saved = JSON.parse(readFileSync(join(folder, FILE), "utf8")) as { calls?: CallRecord[] };
    for (const record of saved.calls ?? []) records.set(record.id, record);
  } catch { /* first start */ }

  function save(): void {
    const all = [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
    const ended = all.filter(isEnded);
    for (const old of ended.slice(0, Math.max(0, ended.length - KEEP_ENDED))) records.delete(old.id);
    writeFileAtomic(join(folder, FILE), JSON.stringify({ calls: [...records.values()] }));
  }

  const transcriptFile = (id: string) => join(folder, `${id}.jsonl`);

  function lines(id: string): CallLine[] {
    const file = transcriptFile(id);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as CallLine]; } catch { return []; }
    }).sort((a, b) => a.at - b.at);
  }

  function addLine(record: CallRecord, line: CallLine): void {
    appendFileSync(transcriptFile(record.id), JSON.stringify({ speaker: line.speaker, text: line.text.slice(0, 4_000), at: line.at }) + "\n");
    record.lines += 1;
    save();
  }

  function seconds(record: CallRecord): number {
    return record.answeredAt ? Math.max(0, Math.round(((record.endedAt ?? now()) - record.answeredAt) / 1_000)) : 0;
  }

  function stopLive(id: string): void {
    const running = live.get(id);
    if (!running) return;
    for (const timer of running.timers) clearTimeout(timer);
    if (running.watchdog) clearInterval(running.watchdog);
    running.bridge?.close();
    live.delete(id);
  }

  function end(record: CallRecord, reason: CallEndReason, detail?: string, opts: { quiet?: boolean } = {}): void {
    if (isEnded(record)) return;
    record.phase = "ended";
    record.endedAt = now();
    record.endReason = record.hangingUp ?? reason;
    if (detail) record.endDetail = detail.slice(0, 500);
    delete record.hangingUp;
    stopLive(record.id);
    if (opts.quiet) {
      save();
      deps.card.update(record);
      return;
    }
    record.summary = "asked";
    save();
    deps.card.update(record);
    void deps.followUp(record, summaryPrompt(record, lines(record.id), seconds(record))).catch((error: unknown) => {
      deps.log(`call ${record.id}: the summary turn did not start: ${error instanceof Error ? error.message : String(error)}`);
      record.summary = "failed";
      save();
    });
  }

  function answered(record: CallRecord): void {
    if (isEnded(record) || record.phase === "in_progress") return;
    record.phase = "in_progress";
    record.answeredAt ??= now();
    save();
    deps.card.update(record);
    const running = live.get(record.id);
    if (!running) return;
    const limitMs = record.maxMinutes * 60_000;
    if (limitMs > WRAP_UP_BEFORE_MS * 2) running.timers.push(setTimeout(() => running.bridge?.wrapUp(WRAP_UP_INSTRUCTION), limitMs - WRAP_UP_BEFORE_MS));
    running.timers.push(setTimeout(() => void hangUp(record.id, "max_length"), limitMs));
    const minuteTick = setInterval(() => deps.card.update(record), 60_000);
    running.timers.push(minuteTick as unknown as NodeJS.Timeout);
  }

  function apply(record: CallRecord, progress: ProviderProgress): void {
    if (isEnded(record)) return;
    switch (progress.kind) {
      case "ringing":
        if (record.phase === "dialing") {
          record.phase = "ringing";
          save();
          deps.card.update(record);
        }
        return;
      case "answered":
        answered(record);
        return;
      case "ended":
        end(record, progress.reason);
        return;
      default:
        return;
    }
  }

  function watch(record: CallRecord, settings: ReadyCalls): void {
    const running = live.get(record.id);
    if (!running) return;
    running.watchdog = setInterval(() => {
      if (isEnded(record) || !record.providerCallId) return;
      deps.provider(settings).progress(record.providerCallId)
        .then((progress) => apply(record, progress))
        .catch((error: unknown) => deps.log(`call ${record.id}: progress check failed: ${error instanceof Error ? error.message : String(error)}`));
    }, deps.watchdogMs ?? 30_000);
    running.watchdog.unref?.();
  }

  async function hangUp(id: string, reason: CallEndReason): Promise<CallRecord> {
    const record = records.get(id);
    if (!record) throw new CallError("There is no call with that call_id.", 404);
    if (isEnded(record)) return record;
    record.hangingUp ??= reason;
    save();
    deps.card.update(record);
    const settings = deps.settings();
    if (!record.providerCallId || "refusal" in settings) {
      end(record, reason);
      return record;
    }
    const wait = setTimeout(() => end(record, reason), deps.hangUpWaitMs ?? 20_000);
    live.get(id)?.timers.push(wait);
    try {
      await deps.provider(settings).hangUp(record.providerCallId);
    } catch (error) {
      deps.log(`call ${id}: hang-up failed: ${error instanceof Error ? error.message : String(error)}`);
      end(record, reason, "Twilio didn't confirm the hang-up.");
    }
    return record;
  }

  function owned(id: string, botId: string): CallRecord {
    const record = records.get(id);
    if (!record || record.botId !== botId) throw new CallError("There is no call with that call_id for you. Use the call_id place_call gave.", 404);
    return record;
  }

  const summary = (record: CallRecord): CallSummary => ({
    id: record.id, botId: record.botId, botName: record.botName, threadId: record.threadId, to: record.to,
    ...(record.calleeName ? { calleeName: record.calleeName } : {}), goal: record.brief.split("\n")[0]!.slice(0, 160),
    phase: record.phase, createdAt: record.createdAt,
    ...(record.answeredAt ? { answeredAt: record.answeredAt } : {}), ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    ...(record.endReason ? { endReason: record.endReason } : {}), seconds: seconds(record), lines: record.lines,
  });

  const urls = (settings: ReadyCalls, record: CallRecord, token: string) => {
    const base = `${settings.publicUrl}${PATH}`;
    return {
      answerUrl: `${base}/answer/${record.id}`,
      statusUrl: `${base}/status/${record.id}`,
      machineUrl: `${base}/machine/${record.id}`,
      streamUrl: `${base.replace(/^https:/, "wss:")}/stream/${record.id}/${token}`,
    };
  };

  return {
    /** Places the call and answers once the provider has it; the rest happens in the background. */
    async place(input: { botId: string; botName: string; threadId: string; to: string; calleeName?: string; brief: string; onBehalfOf: string }): Promise<CallRecord> {
      if (closed) throw new CallError("OpenMausBot is shutting down.");
      const settings = deps.settings();
      if ("refusal" in settings) throw new CallError(settings.refusal);
      const refused = numberRefusal(input.to, settings);
      if (refused) throw new CallError(refused, 403);
      if (input.to === settings.callerId) throw new CallError("That is the caller ID number itself, so I can't call it.", 403);
      const active = [...records.values()].filter((record) => !isEnded(record));
      const mine = active.find((record) => record.botId === input.botId);
      if (mine) throw new CallError(`You already have a call running (call_id ${mine.id}). Wait for it to end, or hang_up first.`);
      if (active.length >= MAX_ACTIVE) throw new CallError(`${MAX_ACTIVE} calls are already running here. Try again when one ends.`);
      const record: CallRecord = {
        id: `c-${randomUUID()}`, botId: input.botId, botName: input.botName, threadId: input.threadId, to: input.to,
        ...(input.calleeName?.trim() ? { calleeName: input.calleeName.trim().slice(0, 80) } : {}), brief: input.brief.trim().slice(0, 4_000),
        onBehalfOf: (settings.onBehalfOf || input.onBehalfOf).slice(0, 80), provider: "twilio", maxMinutes: settings.maxMinutes,
        phase: "dialing", createdAt: now(), lines: 0,
      };
      records.set(record.id, record);
      const token = randomBytes(24).toString("hex");
      live.set(record.id, { token, timers: [] });
      record.cardMessageId = deps.card.show(record) ?? undefined;
      save();
      const at = urls(settings, record, token);
      try {
        const placed = await deps.provider(settings).place({
          to: record.to, from: settings.callerId, answerUrl: at.answerUrl, statusUrl: at.statusUrl, machineUrl: at.machineUrl,
          timeLimitSeconds: record.maxMinutes * 60 + 15, ringSeconds: RING_SECONDS,
        });
        if (isEnded(record)) return record;
        record.providerCallId = placed.providerCallId;
        save();
        watch(record, settings);
        return record;
      } catch (error) {
        const said = error instanceof Error ? error.message : String(error);
        end(record, "failed", said, { quiet: true });
        throw new CallError(said, 502);
      }
    },

    /** The provider asks what to do now that the callee picked up. */
    answer(id: string): string {
      const record = records.get(id);
      const settings = deps.settings();
      const running = live.get(id);
      if (!record || isEnded(record) || !running || "refusal" in settings) return hangUpTwiml();
      const disclosure = disclosureLine(record.onBehalfOf);
      answered(record);
      addLine(record, { speaker: "note", text: disclosure, at: now() });
      return connectStreamTwiml({ disclosure, streamUrl: urls(settings, record, running.token).streamUrl });
    },

    status(id: string, params: { CallStatus?: string; CallDuration?: string }, progress: (status: string | undefined, duration?: string) => ProviderProgress): void {
      const record = records.get(id);
      if (record) apply(record, progress(params.CallStatus, params.CallDuration));
    },

    machine(id: string, machine: boolean): void {
      const record = records.get(id);
      if (record && machine && !isEnded(record)) void hangUp(id, "voicemail");
    },

    /** The provider's media stream for this call: only with the call's own token, only once, only while it runs. */
    stream(id: string, token: string, socket: WebSocket): boolean {
      const record = records.get(id);
      const running = live.get(id);
      const settings = deps.settings();
      if (!record || isEnded(record) || !running || running.bridge || "refusal" in settings) return false;
      const given = Buffer.from(token);
      const expected = Buffer.from(running.token);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
      running.bridge = bridgeCall(socket, () => deps.openRealtime(settings), {
        model: settings.model, voice: settings.voice, transcriptionModel: settings.transcriptionModel,
        instructions: voiceInstructions(record, disclosureLine(record.onBehalfOf)), opening: openingInstruction(record),
      }, {
        started: () => answered(record),
        line: (line) => { if (!isEnded(record)) addLine(record, line); },
        hangUp: () => void hangUp(id, "completed"),
        failed: (detail) => {
          deps.log(`call ${id}: voice failed: ${detail}`);
          record.endDetail = detail.slice(0, 300);
          void hangUp(id, "error");
        },
        closed: () => { if (running.bridge) running.bridge = undefined; },
        log: (line) => deps.log(`call ${id}: ${line}`),
      }, now);
      return true;
    },

    hangUp,
    hangUpFor: (id: string, botId: string) => hangUp(owned(id, botId).id, "hung_up"),
    owned,
    record: (id: string) => records.get(id),
    lines,
    seconds,
    summary,
    list(): CallSummary[] {
      return [...records.values()].sort((a, b) => b.createdAt - a.createdAt).map(summary);
    },
    detail(id: string): CallDetail | null {
      const record = records.get(id);
      return record ? { ...summary(record), brief: record.brief, transcript: lines(id) } : null;
    },
    active: () => [...records.values()].some((record) => !isEnded(record)),
    /** After a restart: a call still running lost its voice, so it is hung up; one that ended meanwhile is closed. */
    async resume(): Promise<void> {
      const settings = deps.settings();
      for (const record of records.values()) {
        if (isEnded(record)) continue;
        if (!record.providerCallId || "refusal" in settings) {
          end(record, "lost", "OpenMausBot restarted during the call.");
          continue;
        }
        try {
          const progress = await deps.provider(settings).progress(record.providerCallId);
          if (progress.kind === "ended") end(record, progress.reason);
          else {
            record.hangingUp = "lost";
            await deps.provider(settings).hangUp(record.providerCallId).catch(() => undefined);
            end(record, "lost", "OpenMausBot restarted during the call.");
          }
        } catch (error) {
          end(record, "lost", error instanceof Error ? error.message : String(error));
        }
      }
    },
    close(): void {
      closed = true;
      for (const id of live.keys()) stopLive(id);
    },
  };
}

export type Calls = ReturnType<typeof createCalls>;
export const CALLS_PATH = PATH;
