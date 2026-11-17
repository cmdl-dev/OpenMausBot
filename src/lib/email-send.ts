import type { Message } from "@/state/store";

const SEND_TOOL = "EMAIL_SEND_MESSAGE";
/** How a step's input ends when it was cut at 6,000 characters. */
const CUT_MARK = "\n[… preview shortened]";

export interface EmailDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  /** The step's input was cut short, so the end of the body is missing. */
  cut: boolean;
}

const isSendTool = (name: string) => name === SEND_TOOL || name.endsWith(`__${SEND_TOOL}`);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function parseInput(input: string): { value: unknown; cut: boolean } | null {
  try { return { value: JSON.parse(input), cut: false }; } catch {}
  if (!input.endsWith(CUT_MARK)) return null;
  const head = input.slice(0, -CUT_MARK.length).replace(/\\(?:u[0-9a-fA-F]{0,3})?$/u, "").replace(/,\s*$/u, "");
  for (const close of ['"}', '"]}', "}", "]}"]) {
    try { return { value: JSON.parse(head + close), cut: true }; } catch {}
  }
  return null;
}

const drafts = new WeakMap<NonNullable<Message["tool"]>, EmailDraft | null>();

/** The email a bot's Email connector send step carries, read from the step's own input; null for any other row. */
export function emailDraftOf(message: Message): EmailDraft | null {
  const tool = message.kind === "activity" ? message.tool : undefined;
  if (!tool?.input || !isSendTool(tool.name)) return null;
  if (drafts.has(tool)) return drafts.get(tool)!;
  const parsed = parseInput(tool.input);
  const args = parsed?.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : null;
  const to = strings(args?.to);
  const draft = args && to.length && typeof args.text === "string"
    ? { to, cc: strings(args.cc), bcc: strings(args.bcc), subject: typeof args.subject === "string" ? args.subject : "", text: args.text, cut: parsed!.cut }
    : null;
  drafts.set(tool, draft);
  return draft;
}
