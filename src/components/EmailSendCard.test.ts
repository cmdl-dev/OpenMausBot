import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { groupTranscript } from "@/lib/activity-runs";
import { emailDraftOf } from "@/lib/email-send";
import { roomActivityVisible } from "@/lib/room-activity";
import { quietRow } from "./chat-bubble";
import { EmailSendCard } from "./EmailSendCard";

const ARGS = { to: ["faith@shop.example"], cc: ["ops@shop.example"], subject: "Re: Your account is on hold", text: "Hi Faith,\n\nHow do I pay the balance?\n\nCesar" };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const step = (tool: Partial<NonNullable<Message["tool"]>> & { name?: string } = {}, id = "s1"): Message =>
  ({ id, role: "bot", kind: "activity", at: 1, turnId: "turn1", tool: { name: "mcp__email__EMAIL_SEND_MESSAGE", input: pretty(ARGS), ...tool } });

describe("the email a bot sends", () => {
  it("is read from the send step's input, under every engine's name for it", () => {
    for (const name of ["mcp__email__EMAIL_SEND_MESSAGE", "EMAIL_SEND_MESSAGE"]) {
      expect(emailDraftOf(step({ name })), name).toEqual({ to: ARGS.to, cc: ARGS.cc, bcc: [], subject: ARGS.subject, text: ARGS.text, cut: false });
    }
  });

  it("is not read from other steps, the server's sent line, or input that isn't an email", () => {
    expect(emailDraftOf(step({ name: "mcp__email__EMAIL_READ_MESSAGE" }))).toBeNull();
    expect(emailDraftOf(step({ name: "GMAIL_SEND_EMAIL" }))).toBeNull();
    expect(emailDraftOf(step({ input: undefined, summary: "Sent from me@shop.example to 1 recipient(s)" }))).toBeNull();
    expect(emailDraftOf(step({ input: pretty({ subject: "Hi", text: "No one to send to" }) }))).toBeNull();
    expect(emailDraftOf(step({ input: "not json" }))).toBeNull();
  });

  it("keeps what came through of a long email whose input was cut short", () => {
    const whole = pretty({ to: ["a@b.example"], subject: "Long", text: `Start ${"word ".repeat(2_000)}` });
    for (const end of [5_999, 5_998, 6_000]) {
      const draft = emailDraftOf(step({ input: `${whole.slice(0, end)}\n[… preview shortened]` }));
      expect(draft, `cut at ${end}`).toMatchObject({ to: ["a@b.example"], subject: "Long", cut: true });
      expect(draft!.text.startsWith("Start word")).toBe(true);
    }
    const midEscape = pretty({ to: ["a@b.example"], subject: "Quote", text: 'He said \\"hi\\" '.repeat(400) });
    const at = midEscape.indexOf("\\", 200) + 1;
    expect(emailDraftOf(step({ input: `${midEscape.slice(0, at)}\n[… preview shortened]` }))).toMatchObject({ cut: true });
  });

  it("stays in view: never folded under Worked for, and shown while tool calls are hidden, in chats and rooms", () => {
    const sent = step({ ok: true });
    const other = step({ name: "Bash", ok: true, input: '{"command":"ls"}' }, "s2");
    const answer: Message = { id: "a1", role: "bot", kind: "text", at: 2, turnId: "turn1", turnTerminal: true, text: "Sent." };
    const items = groupTranscript([other, sent, answer]);
    expect(items.map((item) => item.kind === "message" ? item.message.id : item.kind)).toEqual(["turn", "s1", "a1"]);
    expect(quietRow(sent, false)).toBe(false);
    expect(quietRow(other, false)).toBe(true);
    expect(roomActivityVisible(sent, false)).toBe(true);
  });

  it("shows who it goes to, the subject and the body, then whether it went", () => {
    const render = (tool: NonNullable<Message["tool"]>, live = false) =>
      renderToStaticMarkup(createElement(EmailSendCard, { draft: emailDraftOf(step(tool))!, tool, live }));
    const base = step().tool!;
    const html = render({ ...base, ok: true });
    for (const text of ["faith@shop.example", "ops@shop.example", "Re: Your account is on hold", "How do I pay the balance?", ">Sent<"]) expect(html).toContain(text);
    expect(html).toContain('data-email-send="sent"');
    expect(render(base, true)).toContain("Sending…");
    expect(render(base, false)).toContain('data-email-send="unconfirmed"');
    const failed = render({ ...base, ok: false, problem: "The mail server refused it." });
    expect(failed).toContain("Not sent");
    expect(failed).toContain("The mail server refused it.");
  });
});
