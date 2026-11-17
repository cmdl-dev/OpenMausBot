// Pushes this server sends Apple itself, for an app whose APNs key the owner gave it (an app of their own, which the
// hosted relay's key cannot reach). The key stays in a 0600 file in the data folder, or the environment, and is never
// logged or answered back.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { connect, type ClientHttp2Session } from "node:http2";
import { join } from "node:path";

import {
  PHONE_PUSH_WIRE_VERSION,
  PUSH_BUNDLE_ID,
  PUSH_QUIET_TIME,
  type ApnsEnvironment,
  type DirectApnsPayload,
  type PhonePushNotification,
  type PushQuietHours,
} from "../shared/phone-push.ts";

export const APNS_DIRECT_FILE = "apns-direct.json";
export const APNS_DIRECT_ENV = {
  keyId: "OMB_APNS_KEY_ID",
  teamId: "OMB_APNS_TEAM_ID",
  bundleId: "OMB_APNS_BUNDLE_ID",
  keyFile: "OMB_APNS_KEY_FILE",
  /** Sends every push to this origin instead of Apple's, for a local stand-in. */
  origin: "OMB_APNS_ORIGIN",
} as const;

export const APNS_ORIGINS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

/** Apple refuses a provider token older than an hour and throttles one renewed more often than every 20 minutes. */
export const APNS_TOKEN_WINDOW_MS = 50 * 60_000;
const APNS_EXPIRATION_SECONDS = 24 * 60 * 60;
const APNS_TIMEOUT_MS = 10_000;
const APPLE_ID = /^[A-Z0-9]{10}$/;
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
const PROVIDER_TOKEN_REASONS = new Set(["ExpiredProviderToken", "InvalidProviderToken", "MissingProviderToken"]);

export interface ApnsDirectConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** The .p8 key's PEM. */
  privateKey: string;
}

export type ApnsOutcome =
  | { kind: "sent" }
  | { kind: "dead" }
  | { kind: "retry"; status: number; reason: string }
  | { kind: "failed"; status: number; reason: string };

function parseConfig(value: unknown): ApnsDirectConfig | null {
  if (!value || typeof value !== "object") return null;
  const { keyId, teamId, bundleId, privateKey } = value as Record<string, unknown>;
  if (typeof keyId !== "string" || !APPLE_ID.test(keyId.trim())) return null;
  if (typeof teamId !== "string" || !APPLE_ID.test(teamId.trim())) return null;
  if (typeof bundleId !== "string" || !PUSH_BUNDLE_ID.test(bundleId.trim())) return null;
  if (typeof privateKey !== "string" || !privateKey.includes("PRIVATE KEY")) return null;
  return { keyId: keyId.trim(), teamId: teamId.trim(), bundleId: bundleId.trim(), privateKey: privateKey.trim() };
}

/** The owner's APNs key, first match wins: the four OMB_APNS_* variables, then `<data>/apns-direct.json`. */
export function readApnsDirectConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): ApnsDirectConfig | null {
  const keyFile = env[APNS_DIRECT_ENV.keyFile]?.trim();
  if (keyFile) {
    let privateKey = "";
    try {
      privateKey = readFileSync(keyFile, "utf8");
    } catch {
      return null;
    }
    return parseConfig({ keyId: env[APNS_DIRECT_ENV.keyId], teamId: env[APNS_DIRECT_ENV.teamId], bundleId: env[APNS_DIRECT_ENV.bundleId], privateKey });
  }
  try {
    return parseConfig(JSON.parse(readFileSync(join(dataDir, APNS_DIRECT_FILE), "utf8")));
  } catch {
    return null;
  }
}

/** A valid IANA zone name. */
export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Whether `now` falls inside the quiet window, read on the phone's own clock. A window whose start is after its end
 * crosses midnight; one whose start equals its end is empty. */
export function inQuietHours(quiet: PushQuietHours | undefined, now: number): boolean {
  if (!quiet || !PUSH_QUIET_TIME.test(quiet.start) || !PUSH_QUIET_TIME.test(quiet.end) || !validTimeZone(quiet.timeZone)) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: quiet.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const at = hour * 60 + minute;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/** The push as Apple carries it. `body` repeats `omb` because expo-notifications (SDK 58) hands an app only a remote
 * notification's `body` key as its data. */
export function directApnsPayload(push: PhonePushNotification, options: { pairing?: string; quiet: boolean }): DirectApnsPayload & { body: DirectApnsPayload["omb"] } {
  const omb: DirectApnsPayload["omb"] = {
    v: PHONE_PUSH_WIRE_VERSION,
    kind: push.kind,
    botId: push.botId,
    threadId: push.threadId,
    ...(push.messageId ? { messageId: push.messageId } : {}),
    ...(push.roomId ? { roomId: push.roomId } : {}),
    ...(options.pairing ? { pairing: options.pairing } : {}),
  };
  return {
    aps: {
      alert: { title: push.title, ...(push.body ? { body: push.body } : {}) },
      ...(options.quiet ? {} : { sound: "default" as const }),
      "thread-id": push.threadId,
      "interruption-level": options.quiet ? "passive" : "active",
    },
    omb,
    body: omb,
  };
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** An ES256 provider token (RFC 7518 §3.4: the raw r‖s signature), issued at the start of its window. */
export function apnsProviderToken(config: Pick<ApnsDirectConfig, "keyId" | "teamId">, key: KeyObject, now: number): string {
  const issuedAt = Math.floor((Math.floor(now / APNS_TOKEN_WINDOW_MS) * APNS_TOKEN_WINDOW_MS) / 1_000);
  const signed = `${base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }))}.${base64url(JSON.stringify({ iss: config.teamId, iat: issuedAt }))}`;
  return `${signed}.${base64url(sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }))}`;
}

interface ApnsReply {
  status: number;
  reason: string;
}

export interface ApnsDirectOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Where each environment's requests go; a test points both at a local HTTP/2 server. */
  origins?: Record<ApnsEnvironment, string>;
}

export class ApnsDirect {
  private readonly options: ApnsDirectOptions;
  private readonly now: () => number;
  private loaded: { stamp: string; config: ApnsDirectConfig | null; key: KeyObject | null } | null = null;
  private token: { window: number; fingerprint: string; jwt: string } | null = null;
  private readonly sessions = new Map<string, ClientHttp2Session>();

  constructor(options: ApnsDirectOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Read again whenever the file or the environment's key file changes, so the owner can add the key while it runs. */
  private current(): { config: ApnsDirectConfig; key: KeyObject } | null {
    const env = this.options.env ?? process.env;
    const file = env[APNS_DIRECT_ENV.keyFile]?.trim() || join(this.options.dataDir, APNS_DIRECT_FILE);
    let stamp = "absent";
    try {
      const info = statSync(file);
      stamp = `${file}:${info.mtimeMs}:${info.size}`;
    } catch {
    }
    if (this.loaded?.stamp !== stamp) {
      const config = stamp === "absent" ? null : readApnsDirectConfig(this.options.dataDir, env);
      let key: KeyObject | null = null;
      try {
        key = config ? createPrivateKey(config.privateKey) : null;
      } catch {
        key = null;
      }
      this.loaded = { stamp, config: key ? config : null, key };
      this.token = null;
    }
    return this.loaded.config && this.loaded.key ? { config: this.loaded.config, key: this.loaded.key } : null;
  }

  /** The bundle this server can push to itself, or null when it holds no usable key. */
  bundle(): string | null {
    return this.current()?.config.bundleId ?? null;
  }

  private providerToken(config: ApnsDirectConfig, key: KeyObject): string {
    const window = Math.floor(this.now() / APNS_TOKEN_WINDOW_MS);
    const fingerprint = `${config.teamId}:${config.keyId}`;
    if (this.token && this.token.window === window && this.token.fingerprint === fingerprint) return this.token.jwt;
    const jwt = apnsProviderToken(config, key, this.now());
    this.token = { window, fingerprint, jwt };
    return jwt;
  }

  private session(origin: string): ClientHttp2Session {
    const open = this.sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(origin);
    session.on("error", () => this.sessions.delete(origin));
    session.on("close", () => this.sessions.delete(origin));
    session.unref();
    this.sessions.set(origin, session);
    return session;
  }

  private request(origin: string, headers: Record<string, string>, body: string): Promise<ApnsReply> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (reply: ApnsReply) => {
        if (!settled) {
          settled = true;
          resolve(reply);
        }
      };
      let stream;
      try {
        stream = this.session(origin).request({ ":method": "POST", ...headers });
      } catch {
        done({ status: 0, reason: "unreachable" });
        return;
      }
      let status = 0;
      const chunks: Buffer[] = [];
      stream.setTimeout(APNS_TIMEOUT_MS, () => {
        stream.close();
        done({ status: 0, reason: "timeout" });
      });
      stream.on("response", (head) => {
        status = Number(head[":status"]) || 0;
      });
      stream.on("data", (chunk: Buffer) => {
        if (chunks.reduce((total, part) => total + part.length, 0) < 4_096) chunks.push(chunk);
      });
      stream.on("end", () => {
        let reason = "";
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: unknown };
          reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 64) : "";
        } catch {
        }
        done({ status, reason });
      });
      stream.on("error", () => done({ status: 0, reason: "unreachable" }));
      stream.end(body);
    });
  }

  /** One alert to one phone. The token goes only into the request path, to Apple's own host. */
  async send(device: { token: string; environment: ApnsEnvironment; pairing?: string; quiet?: PushQuietHours }, push: PhonePushNotification, collapseId?: string): Promise<ApnsOutcome> {
    const loaded = this.current();
    if (!loaded) return { kind: "failed", status: 0, reason: "no key" };
    const quiet = inQuietHours(device.quiet, this.now());
    const body = JSON.stringify(directApnsPayload(push, { ...(device.pairing ? { pairing: device.pairing } : {}), quiet }));
    const override = (this.options.env ?? process.env)[APNS_DIRECT_ENV.origin]?.trim();
    const origin = override || (this.options.origins ?? APNS_ORIGINS)[device.environment];
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.request(origin, {
        ":path": `/3/device/${device.token}`,
        authorization: `bearer ${this.providerToken(loaded.config, loaded.key)}`,
        "apns-topic": loaded.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": quiet ? "5" : "10",
        "apns-expiration": String(Math.floor(this.now() / 1_000) + APNS_EXPIRATION_SECONDS),
        ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
        "content-type": "application/json",
      }, body);
      if (reply.status === 200) return { kind: "sent" };
      if (reply.status === 410 || DEAD_TOKEN_REASONS.has(reply.reason)) return { kind: "dead" };
      if (reply.status === 403 && PROVIDER_TOKEN_REASONS.has(reply.reason) && attempt === 0) {
        this.token = null;
        continue;
      }
      if (reply.status === 0 || reply.status === 429 || reply.status >= 500) return { kind: "retry", status: reply.status, reason: reply.reason };
      return { kind: "failed", status: reply.status, reason: reply.reason };
    }
    return { kind: "failed", status: 403, reason: "provider token refused twice" };
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}
