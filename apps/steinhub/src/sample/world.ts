import { CUSTOM_SECRET_TARGET } from "@openmausbot/phone-protocol/credential-request.ts";
import type { InboxRow } from "@openmausbot/phone-protocol/inbox.ts";
import type { ApprovalView, AutomationView, BotView, ComputerView, HostView, MessageView, PersonView, RunView, ThreadView } from "@/state/views";

export const user: PersonView = { name: "Alex Rivera", email: "alex@example.com", initials: "AR" };

export const host: HostView = { name: "Alex's Mac Studio", app: "OpenMausBot 2.4.1", paired: "Nov 12, 2026" };

export const bots: BotView[] = [
  {
    id: "mausbot",
    name: "MausBot",
    chief: true,
    threadId: "lease",
    glyph: "M",
    look: { body: "cursor", color: "purple" },
    role: "Chief of Staff",
    tint: "violet",
    model: "Claude Opus 5.5",
    state: { label: "Waiting on you", tone: "warning" },
    suggestions: ["Summarize my inbox", "Plan my day", "What's waiting on me?", "Draft a reply"],
  },
  {
    id: "mobile-app",
    name: "Mobile App",
    threadId: "push-crash",
    glyph: "A",
    look: { body: "cursor", color: "green" },
    role: "Builds the SteinHub iOS app",
    tint: "green",
    model: "Claude Opus 5.5",
    state: { label: "Working", tone: "info" },
    suggestions: ["Latest TestFlight build", "Open crash reports", "What changed today?"],
  },
  {
    id: "mac-helper",
    name: "Mac helper",
    threadId: "downloads",
    glyph: "H",
    look: { body: "cursor", color: "orange" },
    role: "Runs tasks on the Mac",
    tint: "amber",
    model: "Claude Opus 5.5",
    state: { label: "Idle", tone: "success" },
    suggestions: ["Clean up Downloads", "Free up disk space", "Back up Documents"],
  },
];

export function botById(id: string | undefined): BotView {
  return bots.find((bot) => bot.id === id) ?? bots[0];
}

export const threads: ThreadView[] = [
  { id: "lease", title: "Landlord lease renewal", botId: "mausbot", group: "Today" },
  { id: "push-crash", title: "Fix push notification crash", botId: "mobile-app", group: "Today" },
  { id: "offsite", title: "Plan Thursday offsite", botId: "mausbot", group: "Today" },
  { id: "testflight-42", title: "TestFlight build 42 notes", botId: "mobile-app", group: "Yesterday" },
  { id: "downloads", title: "Clean up Downloads folder", botId: "mac-helper", group: "Yesterday" },
  { id: "eas-profiles", title: "Set up EAS build profiles", botId: "mobile-app", group: "Earlier" },
];

export function threadById(id: string | undefined): ThreadView {
  return threads.find((thread) => thread.id === id) ?? threads[0];
}

export const leaseMessages: MessageView[] = [
  {
    id: "m1",
    from: "user",
    text: "Jordan sent the renewal offer. Rent goes from $2,400 to $2,520 on March 1. I want to counter at $2,450 if I sign for 2 years. Can you draft a reply?",
  },
  {
    id: "m2",
    from: "bot",
    text: "Jordan's offer is a 5% increase. Section 4.2 of your lease caps renewal increases at 5%, so it's allowed, but there's room to negotiate.\n\nAt $2,450 on a 24-month term you'd pay $1,680 less over two years than at $2,520.",
  },
  { id: "m3", from: "user", text: "Looks good. Send it to Jordan, and hold Thursday at 3 in case they want to talk." },
  leaseApproval(),
];

export const SAMPLE_NOW = new Date(2026, 10, 16, 9, 41).getTime();

export const inbox: InboxRow[] = [
  {
    id: "inbox-approval",
    kind: "ask",
    tab: "needs-you",
    from: { name: "MausBot", botId: "mausbot" },
    origin: { botId: "mausbot", threadId: "lease", title: "Landlord lease renewal" },
    text: "Send reply to Jordan (landlord)?",
    at: SAMPLE_NOW - 10 * 60_000,
    unread: true,
    replies: true,
    card: { title: "Send reply to Jordan (landlord)?", subtitle: "Counters at $2,450/month for a 2-year term.", options: ["Approve", "Deny"], tool: "send_email" },
  },
  {
    id: "inbox-secret",
    kind: "ask",
    tab: "needs-you",
    from: { name: "Mobile App", botId: "mobile-app" },
    origin: { botId: "mobile-app", threadId: "testflight-42", title: "TestFlight build 42 notes" },
    text: "App Store Connect API key",
    at: SAMPLE_NOW - 42 * 60_000,
    unread: true,
    replies: true,
    secret: {
      target: CUSTOM_SECRET_TARGET,
      label: "App Store Connect API key",
      description: "To upload builds to TestFlight with the App Store Connect API.",
      placeholder: "Key (.p8 contents)",
      helpUrl: "https://appstoreconnect.apple.com/access/integrations/api",
      requestKey: "asc-api-key",
    },
  },
  {
    id: "inbox-sign-in",
    kind: "notice",
    tab: "needs-you",
    from: { name: "Mac helper", botId: "mac-helper" },
    text: "Sign in to GitHub on Alex's Mac Studio",
    at: SAMPLE_NOW - 3 * 60 * 60_000,
    unread: true,
    signIn: { url: "https://github.com/login", site: "GitHub", place: "local" },
  },
  {
    id: "inbox-brief",
    kind: "result",
    tab: "info",
    from: { name: "MausBot", botId: "mausbot" },
    text: "Morning brief\n4 meetings today, 3 emails need replies, 1 approval waiting.",
    at: SAMPLE_NOW - 2 * 60 * 60_000 - 41 * 60_000,
    unread: true,
  },
  {
    id: "inbox-build",
    kind: "message",
    tab: "info",
    from: { name: "Mobile App", botId: "mobile-app" },
    text: "Build 43 uploaded to TestFlight\nProcessing finished and 4 testers were notified. Release notes are in the thread.",
    at: SAMPLE_NOW - 89 * 60_000,
    unread: true,
  },
  {
    id: "inbox-backup",
    kind: "notice",
    tab: "done",
    from: { name: "Mac helper", botId: "mac-helper" },
    text: "Weekly backup skipped — MacBook Pro was asleep",
    at: SAMPLE_NOW - 5 * 86_400_000,
    unread: false,
  },
];

export const automations: AutomationView[] = [
  {
    id: "weekly-backup",
    name: "Weekly backup",
    botId: "mac-helper",
    trigger: { kind: "schedule", label: "Sundays at 2:00", cron: "0 2 * * 0" },
    runsOn: "MacBook Pro",
    state: "failed",
    failureStreak: 2,
    runs: [
      { id: "b1", at: "Sun 15 Nov, 2:00", outcome: "danger", summary: "MacBook Pro asleep", duration: "10 min" },
      { id: "b2", at: "Sun 8 Nov, 2:00", outcome: "danger", summary: "MacBook Pro asleep", duration: "10 min" },
      { id: "b3", at: "Sun 1 Nov, 2:00", outcome: "success", summary: "Backed up 38 GB", duration: "24 min" },
    ],
    lastRun: { label: "Sun 2:00 · MacBook Pro asleep", tone: "danger" },
  },
  {
    id: "morning-brief",
    name: "Morning brief",
    botId: "mausbot",
    prompt: "Every weekday at 7:00, send me a brief of today's calendar, unread email needing replies, and anything waiting on me.",
    timeZone: "Europe/Berlin",
    trigger: { kind: "schedule", label: "Weekdays at 7:00", cron: "0 7 * * 1-5" },
    runsOn: "Alex's Mac Studio",
    state: "active",
    runs: [],
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
    runs: [],
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
    runs: [],
    lastRun: { label: "Yesterday 18:12 · build 43", tone: "success" },
  },
  {
    id: "price-check",
    name: "Price check: Mac mini",
    botId: "mac-helper",
    trigger: { kind: "schedule", label: "Daily at 12:00", cron: "0 12 * * *" },
    runsOn: "vps-fra-1",
    state: "active",
    runs: [],
    lastRun: { label: "Yesterday 12:00", tone: "success" },
    next: "Next today 12:00",
  },
];

export function automationById(id: string | undefined): AutomationView {
  return automations.find((automation) => automation.id === id) ?? automations[0];
}

export const runs: RunView[] = [
  { id: "r1", at: "Today, 7:00", outcome: "success", summary: "Brief sent · 5 items", duration: "42 s" },
  { id: "r2", at: "Fri 13 Nov, 7:00", outcome: "success", summary: "Brief sent · 7 items", duration: "38 s" },
  { id: "r3", at: "Thu 12 Nov, 7:00", outcome: "danger", summary: "Gmail token expired", duration: "6 s" },
  { id: "r4", at: "Wed 11 Nov, 7:00", outcome: "success", summary: "Brief sent · 4 items", duration: "45 s" },
];

export const computers: ComputerView[] = [
  {
    id: "mac-studio",
    name: "Alex's Mac Studio",
    kind: "desktop",
    os: "macOS 26 · OpenMausBot 2.4.1",
    isHost: true,
    state: { label: "Online", tone: "success" },
    note: "8 ms",
    botIds: ["mausbot", "mobile-app", "mac-helper"],
    metrics: { cpu: 12, mem: 41, disk: 62 },
  },
  {
    id: "macbook-pro",
    name: "MacBook Pro",
    kind: "laptop",
    os: "macOS 26",
    isHost: false,
    state: { label: "Asleep", tone: "warning" },
    note: "last seen 3 h ago",
    botIds: ["mac-helper"],
  },
  {
    id: "vps-fra-1",
    name: "vps-fra-1",
    kind: "server",
    os: "Ubuntu 24.04 · Frankfurt",
    isHost: false,
    state: { label: "Online", tone: "success" },
    note: "31 ms",
    botIds: ["mac-helper"],
    metrics: { cpu: 4, mem: 28, disk: 35 },
  },
];

function leaseApproval(): ApprovalView {
  return {
    id: "m4",
    from: "approval",
    kind: "permission",
    title: "Send this reply to Jordan (landlord)?",
    action: "Send email",
    lines: [
      { label: "To", value: "Jordan Lee <jordan.lee@example.com>" },
      { label: "Subject", value: "Re: Lease renewal, Apt 3B" },
    ],
    preview: "Hi Jordan, thanks for sending the renewal terms. I'd like to stay. Would you consider $2,450 a month if I sign for 24 months?",
    options: ["Approve", "Deny"],
    state: "pending",
  };
}
