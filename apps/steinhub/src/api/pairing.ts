import {
  formatPairingCode,
  PAIRING_CREDENTIAL_PREFIX,
  PAIRING_INPUT_PROBLEM_KEY,
  PAIRING_INPUT_PROBLEM_TEXT,
  readPairingInput,
  type PairingErrorCode,
} from "@openmausbot/phone-protocol/pairing-code.ts";
import { qrEndpoints, type CompanionEndpoint } from "@openmausbot/phone-protocol/pairing-link.ts";
import type { PairRequest, PairResponse } from "@openmausbot/phone-protocol/responses.ts";
import { DesktopError } from "@/api/errors";
import { defaultFetch, errorField, joinUrl, readJson, type FetchLike } from "@/api/transport";

/** A computer to pair with: where to dial, best first, and the one-time secret to redeem there. */
export interface PairingInvite {
  urls: string[];
  credential: string;
  /** The six digits the computer shows, for the person to compare. */
  code?: string;
  name?: string;
}

export const COMPANION_PORT = 8810;
const SIX_DIGITS = /^\d{6}$/;
const CREDENTIAL = new RegExp(`^${PAIRING_CREDENTIAL_PREFIX}[A-Za-z0-9_-]{43}$`);
const PAIR_TIMEOUT_MS = 8_000;

function unique(urls: string[]): string[] {
  return [...new Set(urls)];
}

/** `host`, `host:port` or an http(s) origin as an origin, or null. A bare host gets the companion's port. */
export function computerUrl(raw: string, port = COMPANION_PORT): string | null {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return null;
  const hadScheme = /^https?:\/\//i.test(value);
  let parsed: URL;
  try {
    parsed = new URL(hadScheme ? value : `http://${value}`);
  } catch {
    return null;
  }
  if (!parsed.hostname || parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "")) return null;
  if (parsed.search || parsed.hash) return null;
  return !hadScheme && !parsed.port ? `${parsed.origin}:${port}` : parsed.origin;
}

function base64UrlJson(value: string): unknown {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function linkEndpoints(value: string | null): CompanionEndpoint[] {
  if (!value) return [];
  try {
    const decoded = base64UrlJson(value);
    // SAFETY: qrEndpoints validates every entry and drops anything that isn't a well-formed endpoint.
    return Array.isArray(decoded) ? qrEndpoints(decoded as CompanionEndpoint[]) : [];
  } catch {
    return [];
  }
}

/** The `openmausbot://pair?…` link a computer's QR code carries (built by phone-protocol's `phonePairingLink`). */
export function readPairingLink(raw: string): PairingInvite | null {
  const value = raw.trim();
  const match = /^openmausbot:\/\/pair\?(.*)$/i.exec(value);
  if (!match) return null;
  const fields = new URLSearchParams(match[1]);
  const token = fields.get("token") ?? "";
  const code = fields.get("code") ?? undefined;
  const address = fields.get("address") ?? "";
  if (!CREDENTIAL.test(token) || (code !== undefined && !SIX_DIGITS.test(code))) return null;
  const first = computerUrl(address);
  if (!first) return null;
  const port = Number(new URL(first).port) || COMPANION_PORT;
  const hosts = (fields.get("hosts") ?? "")
    .split(",")
    .map((host) => computerUrl(host, port))
    .filter((url): url is string => url !== null);
  const endpoints = linkEndpoints(fields.get("endpoints")).map((endpoint) => endpoint.url);
  const name = fields.get("name")?.trim() || undefined;
  return { urls: unique([first, ...endpoints, ...hosts]), credential: token, code, name };
}

/** A server's or Cloud's pairing link, `https://host[:port]/pair#code=…` (also `?code=` or `?token=`): its origin is the
 * address and the code or credential it carries is the code. */
export function readServerPairingLink(raw: string): { address: string; code: string } | null {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  const carried = readPairingInput(value);
  if (carried.kind === "code") return { address: parsed.origin, code: formatPairingCode(carried.code) };
  if (carried.kind === "credential") return { address: parsed.origin, code: carried.credential };
  return null;
}

export type ManualPairing = { kind: "ready"; invite: PairingInvite } | { kind: "problem"; field: "address" | "code"; text: string } | { kind: "incomplete" };

/** What the person typed on the "Enter code manually" screen. A pasted pairing link fills both fields. */
export function readManualPairing(address: string, code: string): ManualPairing {
  const link = readPairingLink(address) ?? readPairingLink(code);
  if (link) return { kind: "ready", invite: link };
  const serverLink = readServerPairingLink(address) ?? readServerPairingLink(code);
  if (serverLink) return readManualPairing(serverLink.address, serverLink.code);
  const typedCode = code.replace(/[\s-]/g, "");
  if (!address.trim() || !typedCode) return { kind: "incomplete" };
  const url = computerUrl(address);
  if (!url) {
    return { kind: "problem", field: "address", text: "That isn't an address. Type the pairing address as the computer shows it, like 192.168.1.20:8810." };
  }
  if (SIX_DIGITS.test(typedCode) || CREDENTIAL.test(code.trim())) {
    return { kind: "ready", invite: { urls: [url], credential: SIX_DIGITS.test(typedCode) ? typedCode : code.trim() } };
  }
  const typed = readPairingInput(code);
  if (typed.kind === "code") return { kind: "ready", invite: { urls: [url], credential: formatPairingCode(typed.code) } };
  if (typed.kind === "wrong" && typed.problem !== "notACode" && typed.problem !== "oldCode") {
    return { kind: "problem", field: "code", text: PAIRING_INPUT_PROBLEM_TEXT[PAIRING_INPUT_PROBLEM_KEY[typed.problem]] };
  }
  return { kind: "problem", field: "code", text: "Pairing needs the code the computer shows under Pair a phone, like 7KQ2-M9XD-H4TP." };
}

export interface Paired {
  response: PairResponse;
  baseUrl: string;
  /** Every address worth dialling later, the one that answered first. */
  urls: string[];
}

function isPairResponse(body: unknown): body is PairResponse {
  if (!body || typeof body !== "object") return false;
  const reply = body as Partial<PairResponse>;
  return typeof reply.token === "string" && reply.token.length > 0 && typeof reply.device?.id === "string";
}

async function pairAt(fetch: FetchLike, url: string, request: PairRequest): Promise<PairResponse | "unreachable"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIR_TIMEOUT_MS);
  let status: number;
  let text: string;
  try {
    const response = await fetch(joinUrl(url, "/api/pair"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    status = response.status;
    text = await response.text();
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
  const body = readJson(text, status);
  if (status >= 200 && status < 300 && isPairResponse(body)) return body;
  if (status >= 200 && status < 300) throw new DesktopError("bad-reply", "pairing reply had no token", { status });
  // SAFETY: `code` is read only to pick a sentence; an unknown value falls back to the generic one.
  const code = (body as { code?: PairingErrorCode }).code;
  throw new DesktopError("pairing", errorField(body), { status, pairing: code ?? "pairing_failed" });
}

/** Redeems the invite at its first address that answers. A refusal from any address is final. */
export async function pair(
  invite: PairingInvite,
  options: { deviceName: string; requestId: string; replacesToken?: string; fetch?: FetchLike },
): Promise<Paired> {
  const fetch = options.fetch ?? defaultFetch;
  const request: PairRequest = {
    credential: invite.credential,
    deviceName: options.deviceName,
    pairRequestId: options.requestId,
    ...(options.replacesToken ? { replacesToken: options.replacesToken } : {}),
  };
  for (const url of invite.urls) {
    const result = await pairAt(fetch, url, request);
    if (result === "unreachable") continue;
    const later = qrEndpoints(result.endpoints).map((endpoint) => endpoint.url);
    return { response: result, baseUrl: url, urls: unique([url, ...later, ...invite.urls]) };
  }
  throw new DesktopError("offline", "no address answered");
}
