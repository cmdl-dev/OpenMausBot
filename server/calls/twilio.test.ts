import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_ACCOUNT_SID, FAKE_AUTH_TOKEN, startFakeTwilio, type FakeTwilio } from "../testing/fake-twilio.ts";
import { answeredByMachine, connectStreamTwiml, createTwilioProvider, formParams, twilioApiBase, twilioProgress, validTwilioSignature } from "./twilio.ts";

const URL_SIGNED = "https://calls.example.com/calls/twilio/status/c-1";
const PARAMS = { CallSid: "CA1", CallStatus: "ringing", To: "+14155550100", From: "+14155550199" };
/** Twilio's documented algorithm, written out by hand: the URL, then each name and value sorted by name, HMAC-SHA1, base64. */
const handSigned = (token: string, url: string) =>
  createHmac("sha1", token).update(`${url}CallSidCA1CallStatusringingFrom+14155550199To+14155550100`).digest("base64");

describe("Twilio webhook signatures", () => {
  it("accepts Twilio's signature and nothing else", () => {
    const signature = handSigned(FAKE_AUTH_TOKEN, URL_SIGNED);
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, URL_SIGNED, PARAMS, signature)).toBe(true);
    expect(validTwilioSignature("another-token", URL_SIGNED, PARAMS, signature)).toBe(false);
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, URL_SIGNED, { ...PARAMS, CallStatus: "completed" }, signature)).toBe(false);
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, `${URL_SIGNED}x`, PARAMS, signature)).toBe(false);
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, URL_SIGNED, PARAMS, undefined)).toBe(false);
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, URL_SIGNED, PARAMS, "")).toBe(false);
    expect(validTwilioSignature("", URL_SIGNED, PARAMS, handSigned("", URL_SIGNED))).toBe(false);
  });

  it("accepts a signature made over the URL with the default https port", () => {
    const withPort = handSigned(FAKE_AUTH_TOKEN, "https://calls.example.com:443/calls/twilio/status/c-1");
    expect(validTwilioSignature(FAKE_AUTH_TOKEN, URL_SIGNED, PARAMS, withPort)).toBe(true);
  });

  it("keeps every value of a repeated field", () => {
    expect(formParams("a=1&b=2&a=3")).toEqual({ a: ["1", "3"], b: "2" });
  });
});

describe("Twilio calls", () => {
  let twilio: FakeTwilio;
  beforeAll(async () => { twilio = await startFakeTwilio(); });
  afterAll(async () => { await twilio.close(); });

  const provider = () => createTwilioProvider({ accountSid: FAKE_ACCOUNT_SID, authToken: FAKE_AUTH_TOKEN }, { OMB_TWILIO_API_URL: twilio.url });

  it("talks only to Twilio unless a loopback stand-in is set", () => {
    expect(twilioApiBase({})).toBe("https://api.twilio.com");
    expect(twilioApiBase({ OMB_TWILIO_API_URL: "https://evil.example.com" })).toBe("https://api.twilio.com");
    expect(twilioApiBase({ OMB_TWILIO_API_URL: "http://127.0.0.1:9" })).toBe("http://127.0.0.1:9");
  });

  it("places a call with the caller ID, its webhooks, a time limit and answering-machine detection, as the account", async () => {
    const placed = await provider().place({
      to: "+14155550100", from: "+14155550199", answerUrl: "https://x/answer", statusUrl: "https://x/status", machineUrl: "https://x/machine", timeLimitSeconds: 615, ringSeconds: 45,
    });
    expect(placed.providerCallId).toMatch(/^CA\d+$/);
    const sent = twilio.requests.at(-1)!;
    expect(sent.path).toBe(`/2010-04-01/Accounts/${FAKE_ACCOUNT_SID}/Calls.json`);
    expect(sent.authorization).toBe(`Basic ${Buffer.from(`${FAKE_ACCOUNT_SID}:${FAKE_AUTH_TOKEN}`).toString("base64")}`);
    expect(Object.fromEntries(sent.form)).toMatchObject({
      To: "+14155550100", From: "+14155550199", Url: "https://x/answer", StatusCallback: "https://x/status", TimeLimit: "615", Timeout: "45",
      MachineDetection: "Enable", AsyncAmd: "true", AsyncAmdStatusCallback: "https://x/machine",
    });
    expect(sent.form.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
  });

  it("says plainly what Twilio refused", async () => {
    twilio.failNext(400, { code: 21210, message: "The source phone number provided, +1..., is not yet verified for your account." });
    await expect(provider().place({ to: "+14155550100", from: "+1", answerUrl: "a", statusUrl: "b", machineUrl: "c", timeLimitSeconds: 1, ringSeconds: 1 }))
      .rejects.toThrow("caller ID number isn't verified");
    twilio.failNext(401, { code: 20003, message: "Authenticate" });
    await expect(provider().place({ to: "+14155550100", from: "+1", answerUrl: "a", statusUrl: "b", machineUrl: "c", timeLimitSeconds: 1, ringSeconds: 1 }))
      .rejects.toThrow("Check them in Settings → API keys");
  });

  it("hangs up by completing the call, and reads its progress", async () => {
    const { providerCallId } = await provider().place({ to: "+14155550100", from: "+1", answerUrl: "a", statusUrl: "b", machineUrl: "c", timeLimitSeconds: 1, ringSeconds: 1 });
    await provider().hangUp(providerCallId);
    expect(Object.fromEntries(twilio.requests.at(-1)!.form)).toEqual({ Status: "completed" });
    expect(await provider().progress(providerCallId)).toEqual({ kind: "ended", reason: "completed", seconds: 42 });
  });

  it("maps Twilio's statuses and AnsweredBy", () => {
    expect(twilioProgress("ringing")).toEqual({ kind: "ringing" });
    expect(twilioProgress("in-progress")).toEqual({ kind: "answered" });
    expect(twilioProgress("no-answer")).toEqual({ kind: "ended", reason: "no_answer" });
    expect(twilioProgress("busy", "0")).toEqual({ kind: "ended", reason: "busy", seconds: 0 });
    expect(twilioProgress("queued")).toEqual({ kind: "other" });
    expect(answeredByMachine("machine_end_beep")).toBe(true);
    expect(answeredByMachine("fax")).toBe(true);
    expect(answeredByMachine("human")).toBe(false);
    expect(answeredByMachine(undefined)).toBe(false);
  });

  it("connects the stream at once, with no <Say>, when there is no disclosure to speak", () => {
    expect(connectStreamTwiml({ streamUrl: "wss://x/calls/twilio/stream/c-1/abc" })).toBe(
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Connect><Stream url=\"wss://x/calls/twilio/stream/c-1/abc\"/></Connect></Response>",
    );
  });

  it("says the disclosure before connecting the stream, escaping what it writes", () => {
    expect(connectStreamTwiml({ disclosure: "Hi, this is an AI assistant calling on behalf of Ann & Bo.", streamUrl: "wss://x/calls/twilio/stream/c-1/abc" })).toBe(
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>Hi, this is an AI assistant calling on behalf of Ann &amp; Bo.</Say><Connect><Stream url=\"wss://x/calls/twilio/stream/c-1/abc\"/></Connect></Response>",
    );
  });
});
