import type { FetchLike, ResponseLike, StreamReader } from "@/api/transport";

export interface Call {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** An event stream the test writes into, as the computer would. */
export function pushStream() {
  const chunks: Uint8Array[] = [];
  let waiting: ((result: { done: boolean; value?: Uint8Array }) => void) | null = null;
  let closed = false;
  const encoder = new TextEncoder();
  const reader: StreamReader = {
    read() {
      const next = chunks.shift();
      if (next) return Promise.resolve({ done: false, value: next });
      if (closed) return Promise.resolve({ done: true });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    cancel() {
      closed = true;
      waiting?.({ done: true });
      waiting = null;
      return Promise.resolve();
    },
  };
  return {
    reader,
    send(text: string) {
      const bytes = encoder.encode(text);
      if (waiting) {
        waiting({ done: false, value: bytes });
        waiting = null;
      } else chunks.push(bytes);
    },
    frame(frame: object, id?: string) {
      this.send(`${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(frame)}\n\n`);
    },
    end() {
      closed = true;
      waiting?.({ done: true });
      waiting = null;
    },
  };
}

export type PushStream = ReturnType<typeof pushStream>;

export function jsonResponse(status: number, body: unknown): ResponseLike {
  return { status, text: () => Promise.resolve(JSON.stringify(body)), body: null };
}

export function streamResponse(stream: PushStream): ResponseLike {
  return { status: 200, text: () => Promise.resolve(""), body: { getReader: () => stream.reader } };
}

type Handler = (call: Call) => ResponseLike | Promise<ResponseLike> | undefined;

/** A fetch that answers from `routes` by "METHOD /path", records every call, and throws (unreachable) for the rest. */
export function fakeFetch(routes: Record<string, Handler | ResponseLike>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const call: Call = {
      method: init.method,
      url,
      path: parsed.pathname,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${init.method} ${parsed.origin}${parsed.pathname}`] ?? routes[`${init.method} ${parsed.pathname}`];
    const response = typeof route === "function" ? await route(call) : route;
    if (!response) throw new TypeError("Network request failed");
    return response;
  };
  return { fetch, calls };
}
