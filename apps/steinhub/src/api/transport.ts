import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { DesktopError } from "@/api/errors";

export interface StreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
}

export interface ResponseLike {
  status: number;
  text(): Promise<string>;
  body: { getReader(): StreamReader } | null;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; signal?: AbortSignal },
) => Promise<ResponseLike>;

/** What the client layer needs from the network; tests swap in a fake. */
export interface Transport {
  readonly baseUrl: string;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** Raw bytes in the body, as the attachment routes take them. */
  upload<T>(path: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<T>;
  /** Resolves when the server ends the stream; rejects with a DesktopError when it can't open or breaks. */
  stream(path: string, onText: (text: string) => void, signal: AbortSignal): Promise<void>;
  /** Saves the body to `to` on this phone, replacing what is there; rejects with a DesktopError. */
  download(path: string, to: File): Promise<File>;
}

const REQUEST_TIMEOUT_MS = 20_000;

export const defaultFetch: FetchLike = (url, init) => expoFetch(url, init);

function refusal(status: number, message: string): DesktopError {
  if (status === 401) return new DesktopError("signed-out", message, { status });
  if (status === 426) return new DesktopError("update-app", message, { status });
  if (status === 403 || status === 404) return new DesktopError("refused", message, { status });
  if (status === 503) return new DesktopError("starting", message, { status });
  if (status >= 500) return new DesktopError("server", message, { status });
  return new DesktopError("refused", message, { status });
}

export function readJson(text: string, status: number): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DesktopError("bad-reply", `status ${status}: not JSON`, { status });
  }
}

export function errorField(body: unknown): string {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "";
}

/** expo-file-system 58 rejects a download that isn't 2xx with "response has status 404" (iOS) or "response has status: 404"
 * (Android). */
const DOWNLOAD_STATUS = /response has status:? (\d{3})/;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function httpTransport({
  baseUrl,
  token,
  fetch = defaultFetch,
}: {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
}): Transport {
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };

  async function send(method: string, path: string, init: { body?: string | Uint8Array<ArrayBuffer>; signal?: AbortSignal; accept?: string; type?: string }) {
    try {
      return await fetch(joinUrl(baseUrl, path), {
        method,
        headers: {
          ...headers,
          ...(init.accept ? { accept: init.accept } : {}),
          ...(init.body !== undefined ? { "content-type": init.type ?? "application/json" } : {}),
        },
        body: init.body,
        signal: init.signal,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new DesktopError("offline", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    baseUrl,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await send(method, path, {
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        }).catch((error: unknown) => {
          if (controller.signal.aborted) throw new DesktopError("offline", "timed out");
          throw error;
        });
        const parsed = readJson(await response.text(), response.status);
        if (response.status < 200 || response.status >= 300) throw refusal(response.status, errorField(parsed));
        // SAFETY: the shape is the server's contract for this route, typed by phone-protocol at each call site.
        return parsed as T;
      } finally {
        clearTimeout(timer);
      }
    },
    async upload<T>(path: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<T> {
      const response = await send("POST", path, { body: bytes, type: mime });
      const parsed = readJson(await response.text(), response.status);
      if (response.status < 200 || response.status >= 300) throw refusal(response.status, errorField(parsed));
      // SAFETY: the shape is the server's contract for this route, typed at the call site.
      return parsed as T;
    },
    async download(path, to) {
      try {
        return await File.downloadFileAsync(joinUrl(baseUrl, path), to, { headers: { authorization: headers.authorization }, idempotent: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = DOWNLOAD_STATUS.exec(message);
        throw status ? refusal(Number(status[1]), "") : new DesktopError("offline", message);
      }
    },
    async stream(path, onText, signal) {
      const response = await send("GET", path, { signal, accept: "text/event-stream" });
      if (response.status !== 200 || !response.body) {
        throw refusal(response.status, errorField(readJson(await response.text().catch(() => ""), response.status)));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const cancel = () => void reader.cancel().catch(() => {});
      signal.addEventListener("abort", cancel);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || signal.aborted) return;
          if (value) onText(decoder.decode(value, { stream: true }));
        }
      } catch (error) {
        if (signal.aborted) return;
        throw new DesktopError("offline", error instanceof Error ? error.message : String(error));
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}
