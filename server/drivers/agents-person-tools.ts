// The agents catalog's message_person tool and the internal route behind it (server/host/team-messages.ts), which decides
// where the message goes and refuses in words a bot can repeat. On a team it names a person; anywhere else there is one.
// notify_person alerts the person behind this conversation (server/routes/notify-person.ts).
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PERSON_TOOL_NAMES: ReadonlySet<string> = new Set(["message_person", "notify_person"]);

export async function callPersonTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  if (name === "notify_person") {
    const { ok, body } = await context.client.apiResponse("/api/internal/notify-person", { method: "POST", body: JSON.stringify({ title: args.title, text: args.text }) });
    return ok ? { text: String(body.text ?? "The person was notified.") } : { text: String(body.error ?? "The person could not be notified. Try again shortly."), isError: true };
  }
  const to = typeof args.to === "string" ? args.to.trim() : "";
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return { text: "message_person needs message.", isError: true };
  const { ok, body } = await context.client.apiResponse("/api/internal/people/message", { method: "POST", body: JSON.stringify({ ...(to ? { to } : {}), message }) });
  return ok ? { text: String(body.text ?? "Passed on.") } : { text: String(body.error ?? "The message could not be passed on. Try again shortly."), isError: true };
}

export const PERSON_TOOL_DEFINITIONS = [
  {
    name: "message_person",
    description: "Reach a person in their Inbox, with news they may miss here or when asked to tell someone something. Their answer comes back here. Only what you write goes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        to: { type: "string", maxLength: 254, description: "On a team: their name or email." },
        message: { type: "string", maxLength: 2000, description: "Complete on its own." },
      },
      required: ["message"],
    },
  },
  {
    name: "notify_person",
    description:
      "Alert the person on their phone and computer about something that needs their attention now: an important email, a deadline, a problem, or the result they asked to be told about. The note goes in this chat and the alert opens it here. Never for routine status, progress, or \"nothing new\": a routine run that finds nothing important does not call it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", maxLength: 120, description: "The headline their lock screen shows. No passwords, codes or other secrets." },
        text: { type: "string", maxLength: 4000, description: "Markdown: what they should look at and why, complete on its own." },
      },
      required: ["title", "text"],
    },
  },
];
