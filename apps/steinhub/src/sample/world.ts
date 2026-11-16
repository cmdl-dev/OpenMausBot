import type { InboxRow } from "@openmausbot/phone-protocol/inbox.ts";
import type { BotTint, Status } from "@/theme";

export interface SampleBot {
  id: string;
  name: string;
  role: string;
  tint: BotTint;
  model: string;
  state: { label: string; tone: Status };
  suggestions: string[];
}

export interface SampleThread {
  id: string;
  title: string;
  botId: string;
  group: "Today" | "Yesterday" | "Earlier";
}

export type SampleMessage =
  | { id: string; from: "user"; text: string }
  | { id: string; from: "bot"; text: string; tools?: number }
  | { id: string; from: "approval"; title: string; action: string; to: string; subject: string; preview: string };

export interface SampleAutomation {
  id: string;
  name: string;
  botId: string;
  trigger: { kind: "schedule"; label: string; cron: string } | { kind: "app-event"; label: string };
  runsOn: string;
  state: "active" | "paused" | "failed";
  lastRun: { label: string; tone: Status };
  next?: string;
}

export interface SampleRun {
  id: string;
  at: string;
  outcome: Status;
  summary: string;
}

export interface SampleComputer {
  id: string;
  name: string;
  kind: string;
  os: string;
  state: { label: string; tone: Status };
  detail: string;
}

export const user = { name: "Alex Rivera", email: "alex@example.com", initials: "AR" };

export const host = { name: "Alex's Mac Studio", app: "OpenMausBot 2.4.1", paired: "Nov 12, 2026" };

export const bots: SampleBot[] = [
  {
    id: "mausbot",
    name: "MausBot",
    role: "Chief of Staff",
    tint: "violet",
    model: "Claude Opus 5.5",
    state: { label: "Waiting on you", tone: "warning" },
    suggestions: ["Summarize my inbox", "Plan my day", "What's waiting on me?", "Draft a reply"],
  },
  {
    id: "mobile-app",
    name: "Mobile App",
    role: "Builds the SteinHub iOS app",
    tint: "green",
    model: "Claude Opus 5.5",
    state: { label: "Working", tone: "info" },
    suggestions: ["Latest TestFlight build", "Open crash reports", "What changed today?"],
  },
  {
    id: "mac-helper",
    name: "Mac helper",
    role: "Runs tasks on the Mac",
    tint: "amber",
    model: "Claude Opus 5.5",
    state: { label: "Idle", tone: "success" },
    suggestions: ["Clean up Downloads", "Free up disk space", "Back up Documents"],
  },
];

export function botById(id: string | undefined): SampleBot {
  return bots.find((bot) => bot.id === id) ?? bots[0];
}

export const threads: SampleThread[] = [
  { id: "lease", title: "Landlord lease renewal", botId: "mausbot", group: "Today" },
  { id: "push-crash", title: "Fix push notification crash", botId: "mobile-app", group: "Today" },
  { id: "offsite", title: "Plan Thursday offsite", botId: "mausbot", group: "Today" },
  { id: "testflight-42", title: "TestFlight build 42 notes", botId: "mobile-app", group: "Yesterday" },
  { id: "downloads", title: "Clean up Downloads folder", botId: "mac-helper", group: "Yesterday" },
  { id: "eas-profiles", title: "Set up EAS build profiles", botId: "mobile-app", group: "Earlier" },
];

export function threadById(id: string | undefined): SampleThread {
  return threads.find((thread) => thread.id === id) ?? threads[0];
}

export const leaseMessages: SampleMessage[] = [
  {
    id: "m1",
    from: "user",
    text: "Jordan sent the renewal offer. Rent goes from $2,400 to $2,520 on March 1. I want to counter at $2,450 if I sign for 2 years. Can you draft a reply?",
  },
  {
    id: "m2",
    from: "bot",
    tools: 3,
    text: "Jordan's offer is a 5% increase. Section 4.2 of your lease caps renewal increases at 5%, so it's allowed, but there's room to negotiate.\n\nAt $2,450 on a 24-month term you'd pay $1,680 less over two years than at $2,520.",
  },
  { id: "m3", from: "user", text: "Looks good. Send it to Jordan, and hold Thursday at 3 in case they want to talk." },
  {
    id: "m4",
    from: "approval",
    title: "Send this reply to Jordan (landlord)?",
    action: "Send email",
    to: "Jordan Lee <jordan.lee@example.com>",
    subject: "Re: Lease renewal, Apt 3B",
    preview: "Hi Jordan, thanks for sending the renewal terms. I'd like to stay. Would you consider $2,450 a month if I sign for 24 months?",
  },
];

const SAMPLE_NOW = Date.UTC(2026, 10, 16, 9, 41);

export const inbox: InboxRow[] = [
  {
    id: "inbox-approval",
    kind: "ask",
    tab: "needs-you",
    from: { name: "MausBot", botId: "mausbot" },
    origin: { botId: "mausbot", threadId: "lease", title: "Landlord lease renewal" },
    text: "Send this reply to Jordan (landlord)?",
    at: SAMPLE_NOW - 10 * 60_000,
    unread: true,
    replies: true,
  },
  {
    id: "inbox-secret",
    kind: "ask",
    tab: "needs-you",
    from: { name: "Mobile App", botId: "mobile-app" },
    origin: { botId: "mobile-app", threadId: "testflight-42", title: "TestFlight build 42 notes" },
    text: "App Store Connect API key needed to read build 43.",
    at: SAMPLE_NOW - 42 * 60_000,
    unread: true,
    replies: true,
  },
  {
    id: "inbox-sign-in",
    kind: "notice",
    tab: "needs-you",
    from: { name: "Mac helper", botId: "mac-helper" },
    text: "Sign in to Dropbox so the weekly backup can run.",
    at: SAMPLE_NOW - 3 * 60 * 60_000,
    unread: true,
  },
  {
    id: "inbox-brief",
    kind: "result",
    tab: "info",
    from: { name: "MausBot", botId: "mausbot" },
    text: "Morning brief is ready. Two items need you: an approval and a secret request.",
    at: SAMPLE_NOW - 2 * 60 * 60_000,
    unread: false,
  },
];

export const automations: SampleAutomation[] = [
  {
    id: "weekly-backup",
    name: "Weekly backup",
    botId: "mac-helper",
    trigger: { kind: "schedule", label: "Sundays at 2:00", cron: "0 2 * * 0" },
    runsOn: "MacBook Pro",
    state: "failed",
    lastRun: { label: "Sun 2:00 · MacBook Pro asleep", tone: "danger" },
  },
  {
    id: "morning-brief",
    name: "Morning brief",
    botId: "mausbot",
    trigger: { kind: "schedule", label: "Weekdays at 7:00", cron: "0 7 * * 1-5" },
    runsOn: "Alex's Mac Studio",
    state: "active",
    lastRun: { label: "Today 7:00", tone: "success" },
    next: "Next tomorrow 7:00",
  },
  {
    id: "inbox-triage",
    name: "Inbox triage",
    botId: "mausbot",
    trigger: { kind: "schedule", label: "Every 30 min, 8:00–20:00", cron: "*/30 8-20 * * *" },
    runsOn: "Alex's Mac Studio",
    state: "active",
    lastRun: { label: "9:30", tone: "success" },
    next: "Next 10:00",
  },
  {
    id: "testflight-watcher",
    name: "TestFlight watcher",
    botId: "mobile-app",
    trigger: { kind: "app-event", label: "TestFlight build processed" },
    runsOn: "Alex's Mac Studio",
    state: "active",
    lastRun: { label: "Yesterday 18:12 · build 43", tone: "success" },
  },
  {
    id: "price-check",
    name: "Price check: Mac mini",
    botId: "mac-helper",
    trigger: { kind: "schedule", label: "Daily at 12:00", cron: "0 12 * * *" },
    runsOn: "vps-fra-1",
    state: "active",
    lastRun: { label: "Yesterday 12:00", tone: "success" },
    next: "Next today 12:00",
  },
];

export function automationById(id: string | undefined): SampleAutomation {
  return automations.find((automation) => automation.id === id) ?? automations[0];
}

export const runs: SampleRun[] = [
  { id: "r1", at: "Today 7:00", outcome: "success", summary: "Brief sent · 4 calendar items, 2 replies needed" },
  { id: "r2", at: "Fri 7:00", outcome: "success", summary: "Brief sent · 3 calendar items" },
  { id: "r3", at: "Thu 7:00", outcome: "danger", summary: "Mac Studio was asleep · retried for 10 min" },
];

export const computers: SampleComputer[] = [
  {
    id: "mac-studio",
    name: "Alex's Mac Studio",
    kind: "Desktop host",
    os: "macOS",
    state: { label: "Online", tone: "success" },
    detail: "OpenMausBot 2.4.1 · 3 bots",
  },
  {
    id: "macbook-pro",
    name: "MacBook Pro",
    kind: "Laptop",
    os: "macOS",
    state: { label: "Asleep", tone: "warning" },
    detail: "Last seen 2 h ago",
  },
  {
    id: "vps-fra-1",
    name: "vps-fra-1",
    kind: "VPS",
    os: "Ubuntu 24.04",
    state: { label: "Online", tone: "success" },
    detail: "Runs Price check: Mac mini",
  },
];
