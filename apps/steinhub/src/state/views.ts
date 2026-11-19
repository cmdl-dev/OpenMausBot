import { botAvatarProfile, mascotFaceInk } from "@openmausbot/phone-protocol/bot-avatar.ts";
import { cronScheduleLabel } from "@openmausbot/phone-protocol/cron-label.ts";
import { botMascotBody, type MascotBodyId } from "@openmausbot/phone-protocol/mascot-bodies.ts";
import type { Routine, RoutineRun, RoutineSchedule } from "@openmausbot/phone-protocol/routines.ts";
import type { WidgetPayload } from "@openmausbot/phone-protocol/widget.ts";
import { isSnoozed, orderedThreadList, type MausColor, type OptionCardData, type WireBot, type WireMessage, type WireTask } from "@openmausbot/phone-protocol/wire.ts";
import { readMessageAttachments, type SentAttachment } from "@/api/attachments";
import type { PendingSend, StreamingItem } from "@/state/live-world";
import { settledMarkdown } from "@/state/settled-markdown";
import { tintForIndex, type BotTint, type Status } from "@/theme";

/** How a bot looks on the desktop: its mascot, or the picture it was given instead. */
export interface BotLook {
  body: MascotBodyId;
  color: MausColor;
  faceInk?: string;
  picture?: { path: string; crop: "circle" | "rounded" | "square" };
}

export interface BotView {
  id: string;
  name: string;
  /** The sidebar section it is filed under on the computer; absent: the main Bots list. */
  section?: string;
  chief?: boolean;
  /** The conversation the bot has open, where tapping it goes. */
  threadId?: string;
  folders?: FolderView[];
  pinned?: boolean;
  glyph: string;
  look?: BotLook;
  role: string;
  tint: BotTint;
  model: string;
  /** The engine and model id the bot runs on; absent in the sample world. */
  modelSelection?: { instanceId: string; model: string };
  state: { label: string; tone: Status };
  suggestions: string[];
}

/** One engine on the computer and the models a bot can run on it. */
export interface EngineView {
  instanceId: string;
  name: string;
  /** Why it can't be picked right now; absent when it can. */
  unavailable?: string;
  models: { id: string; label: string }[];
}

export type ThreadGroup = "Today" | "Yesterday" | "Earlier";

export interface ThreadView {
  id: string;
  title: string;
  botId: string;
  group: ThreadGroup;
  busy?: boolean;
  unread?: boolean;
  /** The folder it is filed in. */
  folderId?: string;
  /** The bot that opened it, when a bot rather than the person did. */
  openedBy?: string;
  /** Its newest activity, epoch ms. */
  at?: number;
}

export interface FolderView {
  id: string;
  name: string;
  emoji?: string;
}

export interface ApprovalView {
  id: string;
  from: "approval";
  kind: "permission" | "question";
  title: string;
  action: string;
  lines: Array<{ label: string; value: string }>;
  preview?: string;
  options: string[];
  state: "pending" | "approved" | "denied" | "answered" | "closed";
  answer?: string;
  requestId?: string;
}

/** Work handed to another bot ("Sent to eBay Seller"), or that bot's answer coming back ("eBay Seller replied"). */
export interface HandoffView {
  id: string;
  from: "handoff";
  label: string;
  ok: boolean;
  doneWhen?: string;
  /** The answer that came back, on a reply row. */
  result?: string;
  /** Where the work happens, when it is a conversation the phone can open. */
  threadId?: string;
  /** The teammate it went to or came back from. */
  botId?: string;
}

/** A card a bot or the computer drew in the chat (the daily brief, a form, a list to pick from). */
export interface WidgetView {
  id: string;
  from: "widget";
  messageId: string;
  at?: number;
  widget: WidgetPayload;
}

export type MessageView =
  | { id: string; from: "user"; text: string; attachments?: SentAttachment[]; pending?: "sending" | "failed" }
  | {
      id: string;
      from: "bot";
      text: string;
      at?: number;
      streaming?: boolean;
      images?: SentAttachment[];
      /** The computer's id for the message, which a notification can point at. */
      messageId?: string;
      /** A note the bot posted with notify_person. */
      alert?: { title: string };
    }
  | { id: string; from: "working" }
  | HandoffView
  | ApprovalView
  | WidgetView;

export interface RunView {
  id: string;
  at: string;
  outcome: Status;
  summary: string;
  duration?: string;
  /** The conversation the run reported to or ran in. */
  threadId?: string;
}

export interface AutomationView {
  id: string;
  name: string;
  botId: string;
  trigger: { kind: "schedule"; label: string; cron?: string } | { kind: "app-event"; label: string };
  runsOn: string;
  state: "active" | "paused" | "failed";
  lastRun: { label: string; tone: Status } | null;
  next?: string;
  runs: RunView[];
  prompt?: string;
  timeZone?: string;
  failureStreak?: number;
}

export interface ComputerView {
  id: string;
  name: string;
  kind: "desktop" | "laptop" | "server";
  /** OS and version line, as "macOS 26 · OpenMausBot 2.4.1". */
  os: string;
  isHost: boolean;
  state: { label: string; tone: Status };
  /** After the state: latency, or when it was last seen. */
  note?: string;
  botIds: string[];
  /** Percent used, while online. */
  metrics?: { cpu: number; mem: number; disk: number };
}

export interface HostView {
  name: string;
  app: string;
  paired: string;
}

export interface PersonView {
  name: string;
  email: string;
  initials: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function clock(at: number): string {
  const date = new Date(at);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDate(at: number): string {
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "Today 7:00", "Yesterday 18:12", "Fri 7:00", "Nov 3": the mockups' way of saying when. */
export function formatWhen(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `Today ${clock(at)}`;
  if (days === 1) return `Yesterday ${clock(at)}`;
  if (days === -1) return `Tomorrow ${clock(at)}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[new Date(at).getDay()]} ${clock(at)}`;
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "now", "5 min ago", "2 h ago", "3 d ago": how long since, as the desktop sidebar says it. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "9:30" today, "Sun" this week, "Nov 3" before: the inbox's message times. */
export function shortWhen(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return clock(at);
  if (days < 7) return WEEKDAYS[new Date(at).getDay()];
  const date = new Date(at);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function threadGroup(at: number, now = Date.now()): ThreadGroup {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

const TINTS: Partial<Record<MausColor, BotTint>> = {
  purple: "violet",
  green: "green",
  teal: "green",
  orange: "amber",
  yellow: "amber",
  blue: "blue",
  cyan: "blue",
  red: "rose",
  pink: "rose",
  coral: "rose",
};

const ACTIVITY: Record<NonNullable<WireBot["activity"]>, { label: string; tone: Status }> = {
  working: { label: "Working", tone: "info" },
  "waiting-on-you": { label: "Waiting on you", tone: "warning" },
  idle: { label: "Idle", tone: "success" },
  "no-signal": { label: "No signal", tone: "danger" },
  dead: { label: "Stopped", tone: "danger" },
  "parked.computer": { label: "Waiting for its computer", tone: "warning" },
};

export const LIVE_SUGGESTIONS = ["What's waiting on me?", "Plan my day", "Summarize today"];

export function botLook(bot: Pick<WireBot, "color" | "mascotBody" | "mascotFaceColor" | "avatarUrl" | "avatarCrop">): BotLook {
  const profile = botAvatarProfile({ avatarUrl: bot.avatarUrl, avatarCrop: bot.avatarCrop });
  return {
    body: botMascotBody(bot.mascotBody),
    color: bot.color,
    faceInk: mascotFaceInk(bot.mascotFaceColor),
    picture: profile.avatarUrl && profile.avatarCrop !== "mascot" ? { path: profile.avatarUrl, crop: profile.avatarCrop } : undefined,
  };
}

export function botView(bot: WireBot, index: number, modelLabels: Record<string, string>): BotView {
  const activity = bot.activity ?? (bot.busy ? "working" : "idle");
  return {
    id: bot.id,
    name: bot.name,
    section: bot.section || undefined,
    chief: bot.chiefOfStaff === true || undefined,
    threadId: bot.threadId || undefined,
    folders: bot.projects?.map((project) => ({ id: project.id, name: project.name, emoji: project.emoji })),
    pinned: bot.pinned === true || undefined,
    glyph: (Array.from(bot.name.trim())[0] ?? "?").toUpperCase(),
    look: botLook(bot),
    role: bot.title || bot.description,
    tint: TINTS[bot.color] ?? tintForIndex(index),
    model: modelLabels[bot.modelSelection.model] ?? bot.modelSelection.model,
    modelSelection: { instanceId: bot.modelSelection.instanceId, model: bot.modelSelection.model },
    state: ACTIVITY[activity],
    suggestions: LIVE_SUGGESTIONS,
  };
}

function listed(task: WireTask, now: number): boolean {
  return !task.routineRunId && task.archivedAt === undefined && !task.closedBy && (task.pinned === true || !isSnoozed(task, now));
}

export function threadViews(bots: readonly WireBot[], now = Date.now()): ThreadView[] {
  const rows = bots.flatMap((bot) => (bot.tasks ?? []).filter((task) => listed(task, now)).map((task) => ({ bot, task })));
  const order = orderedThreadList(rows.map(({ task }) => task));
  const owner = new Map(rows.map(({ bot, task }) => [task.threadId, bot.id]));
  return order.map((task) => {
    const at = task.lastThreadOrderAt ?? task.updatedAt ?? task.createdAt;
    return {
      id: task.threadId,
      title: task.title,
      botId: owner.get(task.threadId) ?? "",
      group: threadGroup(at, now),
      busy: task.busy === true,
      unread: task.unread === true || undefined,
      folderId: task.projectId,
      openedBy: task.openedBy?.name,
      at,
    };
  });
}

export function taskOf(bots: readonly WireBot[], threadId: string): { bot: WireBot; task: WireTask } | null {
  for (const bot of bots) {
    const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
    if (task) return { bot, task };
  }
  return null;
}

/** `mcp__gmail__send_email` → "Send email". */
export function toolLabel(tool: string | undefined): string {
  if (!tool) return "Question";
  const name = tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/[_-]+/g, " ").trim();
  return name ? name[0].toUpperCase() + name.slice(1) : tool;
}

export function cardView(message: WireMessage, card: OptionCardData): ApprovalView {
  const kind = card.tool || card.requestType === "permission" ? "permission" : "question";
  const answer = card.answeredText ?? card.answered;
  let state: ApprovalView["state"] = card.requestId ? "pending" : "closed";
  if (card.answered !== undefined) state = kind === "question" ? "answered" : /deny|don't|no\b/i.test(card.answered) ? "denied" : "approved";
  else if (card.expired || card.stopped || card.dismissed) state = "closed";
  return {
    id: message.id,
    from: "approval",
    kind,
    title: card.title,
    action: toolLabel(card.tool),
    lines: [],
    preview: card.subtitle || undefined,
    options: card.options,
    state,
    answer,
    requestId: card.requestId,
  };
}

/** Rows that aren't the bot's words: context markers, screen frames, and the harness's own work summaries. */
const HIDDEN_KINDS = new Set<WireMessage["kind"]>(["compaction", "screen", "digest"]);

export function messageViews(
  messages: readonly WireMessage[],
  extras: { streaming?: readonly StreamingItem[]; pending?: readonly PendingSend[]; busy?: boolean } = {},
): MessageView[] {
  const views: MessageView[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      if (message.kind === "text" && message.text && !message.reaction) views.push({ id: message.id, from: "user", ...userLine(message.text) });
      continue;
    }
    if (message.kind === "activity") {
      const handoff = handoffView(message);
      if (handoff) views.push(handoff);
      continue;
    }
    if (message.kind === "options" && message.card) {
      views.push(cardView(message, message.card));
      continue;
    }
    if (message.kind === "widget" && message.widget) {
      views.push({ id: message.id, from: "widget", messageId: message.id, at: message.at, widget: message.widget });
      continue;
    }
    const images = sentImages(message);
    if (HIDDEN_KINDS.has(message.kind) || (!message.text && !images.length)) continue;
    views.push({
      id: message.itemId ? replyKey(message.itemId) : message.id,
      from: "bot",
      text: message.text ?? "",
      at: message.at,
      messageId: message.id,
      ...(images.length ? { images } : {}),
      ...(message.alert ? { alert: { title: message.alert.title } } : {}),
    });
  }
  for (const send of extras.pending ?? []) {
    views.push({ id: `send:${send.sendId}`, from: "user", ...userLine(send.text), pending: send.failed ? "failed" : "sending" });
  }
  const streaming = (extras.streaming ?? []).filter((item) => item.text.trim());
  for (const item of streaming) views.push({ id: replyKey(item.key), from: "bot", text: settledMarkdown(item.text), streaming: true });
  if (!streaming.length && extras.busy) views.push({ id: "working", from: "working" });
  return views;
}

/** The pictures a bot sent with a reply; screenshots its tools took while it worked stay out of the chat. */
function sentImages(message: WireMessage): SentAttachment[] {
  return (message.attachments ?? []).flatMap((file) =>
    file.kind === "image" && !file.fromTool ? [{ kind: "image" as const, path: file.path, name: file.name ?? "Image" }] : [],
  );
}

/** One key for a reply while it streams and once it is saved, so its row stays on screen between the two. */
function replyKey(itemId: string): string {
  return `item:${itemId}`;
}

function userLine(text: string): { text: string; attachments?: SentAttachment[] } {
  const read = readMessageAttachments(text);
  return read.attachments.length ? read : { text };
}

function handoffView(message: WireMessage): HandoffView | null {
  if (!message.tool || !(message.threadRef || message.comm)) return null;
  const result = message.roomRequest?.phase === "result" ? message.tool.output?.trim() : undefined;
  return {
    id: message.id,
    from: "handoff",
    label: message.tool.label ?? message.tool.name,
    ok: message.tool.ok !== false,
    doneWhen: message.doneWhen?.trim() || undefined,
    result: result || undefined,
    threadId: message.threadRef?.threadId,
    botId: message.threadRef?.botId ?? message.comm?.withBotId,
  };
}

function scheduleLabel(schedule: RoutineSchedule): string {
  switch (schedule.type) {
    case "cron":
      return cronScheduleLabel(schedule);
    case "daily": {
      const days = schedule.weekdays;
      const when =
        days.length === 0 || days.length === 7
          ? "Daily"
          : days.join(",") === "1,2,3,4,5"
            ? "Weekdays"
            : days.map((day) => WEEKDAYS[day]).join(", ");
      return `${when} at ${schedule.time.replace(/^0(\d)/, "$1")}`;
    }
    case "interval": {
      const every = schedule.everyMinutes % 60 === 0 ? `Every ${schedule.everyMinutes / 60} h` : `Every ${schedule.everyMinutes} min`;
      return schedule.window ? `${every}, ${schedule.window.start}–${schedule.window.end}` : every;
    }
    case "once":
      return `Once, ${formatWhen(schedule.at)}`;
    case "limit_reset":
      return "When the usage limit resets";
  }
}

const RUN_TONE: Partial<Record<RoutineRun["status"], Status>> = {
  failed: "danger",
  missed: "danger",
  running: "info",
  queued: "info",
  waiting: "warning",
  cancelled: "warning",
};

export function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

function runView(run: RoutineRun, now: number): RunView {
  const at = run.startedAt ?? run.scheduledFor;
  const summary = run.error ?? run.attention ?? run.output?.split("\n").find((line) => line.trim()) ?? run.status;
  return {
    id: run.id,
    at: formatWhen(at, now),
    outcome: RUN_TONE[run.status] ?? "success",
    summary: summary.slice(0, 140),
    duration: run.startedAt && run.finishedAt ? duration(run.finishedAt - run.startedAt) : undefined,
    threadId: (run.report?.state === "posted" ? run.report.threadId : undefined) ?? run.threadId ?? run.resultsThreadId ?? run.executionThreadId,
  };
}

export function automationView(routine: Routine, runs: readonly RoutineRun[], hostName: string, now = Date.now()): AutomationView {
  const own = runs
    .filter((run) => run.routineId === routine.id)
    .sort((a, b) => (b.finishedAt ?? b.scheduledFor) - (a.finishedAt ?? a.scheduledFor));
  const latest = own[0];
  const state = routine.enabled ? "active" : (routine.failureStreak ?? 0) > 0 ? "failed" : "paused";
  return {
    id: routine.id,
    name: routine.name,
    botId: routine.botId,
    trigger: { kind: "schedule", label: scheduleLabel(routine.schedule), cron: routine.schedule.type === "cron" ? routine.schedule.expression : undefined },
    runsOn: routine.runOn === "cloud" ? "the Cloud" : hostName,
    state,
    lastRun: latest ? { label: runView(latest, now).at, tone: runView(latest, now).outcome } : null,
    next: routine.enabled && routine.nextRunAt ? `Next ${formatWhen(routine.nextRunAt, now).replace(/^Today /, "").replace(/^Tomorrow/, "tomorrow")}` : undefined,
    runs: own.slice(0, 20).map((run) => runView(run, now)),
    prompt: routine.prompt || undefined,
    timeZone: routine.schedule.type === "cron" ? routine.schedule.timeZone : undefined,
    failureStreak: routine.failureStreak || undefined,
  };
}

export interface BotSection {
  /** "chief": the Chief of Staff, apart; "main": bots in no section; "section": one of the computer's sections. */
  kind: "chief" | "main" | "section";
  name: string;
  bots: BotView[];
}

/** The desktop sidebar's order: the Chief of Staff on its own, unsectioned bots under Bots, then each section in the
 * computer's order (a section only a bot names comes after), its own Chief first. Empty sections are left out. */
export function botSections(bots: readonly BotView[], order: readonly string[]): BotSection[] {
  const names = [...order];
  for (const bot of bots) if (bot.section && !names.includes(bot.section)) names.push(bot.section);
  const chiefFirst = (list: BotView[]) => [...list.filter((bot) => bot.chief), ...list.filter((bot) => !bot.chief)];
  const sections: BotSection[] = [
    { kind: "chief", name: "Chief of Staff", bots: bots.filter((bot) => bot.chief && !bot.section) },
    { kind: "main", name: "Bots", bots: bots.filter((bot) => !bot.chief && !bot.section) },
    ...names.map((name): BotSection => ({ kind: "section", name, bots: chiefFirst(bots.filter((bot) => bot.section === name)) })),
  ];
  return sections.filter((section) => section.bots.length > 0);
}
