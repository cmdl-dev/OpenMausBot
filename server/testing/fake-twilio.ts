// Stand-ins for Twilio's REST API and its side of a call (the webhooks it sends, the media stream it opens), and for
// the OpenAI Realtime server, so a whole call runs locally with no network.
import { createServer, type IncomingMessage, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { twilioSignature } from "../calls/twilio.ts";

export const FAKE_ACCOUNT_SID = `AC${"0".repeat(31)}1`;
export const FAKE_AUTH_TOKEN = "fake-twilio-auth-token-0123";

export interface FakeTwilio {
  url: string;
  requests: Array<{ method: string; path: string; form: URLSearchParams; authorization?: string }>;
  /** Answers the next Calls.json POST with this error instead of a call. */
  failNext(status: number, body: Record<string, unknown>): void;
  status: Map<string, string>;
  close(): Promise<void>;
}

const body = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

export async function startFakeTwilio(): Promise<FakeTwilio> {
  const requests: FakeTwilio["requests"] = [];
  const status = new Map<string, string>();
  let failure: { status: number; body: Record<string, unknown> } | null = null;
  let next = 0;
  const server = createServer(async (req, res) => {
    const form = new URLSearchParams(await body(req));
    const path = new URL(req.url ?? "/", "http://fake").pathname;
    requests.push({ method: req.method ?? "", path, form, ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && path.endsWith("/Calls.json")) {
      if (failure) {
        const { status: code, body: answer } = failure;
        failure = null;
        res.writeHead(code).end(JSON.stringify(answer));
        return;
      }
      const sid = `CA${String(++next).padStart(32, "0")}`;
      status.set(sid, "queued");
      res.writeHead(201).end(JSON.stringify({ sid, status: "queued" }));
      return;
    }
    const one = /\/Calls\/(CA\d+)\.json$/.exec(path);
    if (one) {
      if (req.method === "POST" && form.get("Status") === "completed") status.set(one[1]!, "completed");
      res.writeHead(200).end(JSON.stringify({ sid: one[1], status: status.get(one[1]!) ?? "completed", duration: "42" }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ code: 20404, message: "not found" }));
  });
  const url = await listen(server);
  return {
    url, requests, status,
    failNext(code, answer) { failure = { status: code, body: answer }; },
    close: () => closeServer(server),
  };
}

/** Twilio calling one of our webhooks: a signed form POST. */
export async function twilioWebhook(listenerUrl: string, publicUrl: string, path: string, params: Record<string, string>, authToken = FAKE_AUTH_TOKEN, signature?: string): Promise<{ status: number; text: string }> {
  const signed = signature ?? twilioSignature(authToken, `${publicUrl}${path}`, params);
  const response = await fetch(`${listenerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signed },
    body: new URLSearchParams(params).toString(),
  });
  return { status: response.status, text: await response.text() };
}

export interface FakeRealtime {
  url: string;
  /** Every event a session sent, in order, per session. */
  sessions: Array<{ authorization?: string; path: string; received: Array<Record<string, unknown>>; socket: WebSocket }>;
  /** Waits for a session to have sent an event of this type. */
  waitFor(type: string, index?: number): Promise<Record<string, unknown>>;
  send(event: Record<string, unknown>, index?: number): void;
  close(): Promise<void>;
}

export async function startFakeRealtime(): Promise<FakeRealtime> {
  const server = createServer((_req, res) => void res.writeHead(404).end());
  const wss = new WebSocketServer({ server });
  const sessions: FakeRealtime["sessions"] = [];
  const waiters: Array<() => void> = [];
  wss.on("connection", (socket, req) => {
    const session = { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), path: req.url ?? "", received: [] as Array<Record<string, unknown>>, socket };
    sessions.push(session);
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      session.received.push(event);
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated", session: event.session }));
      for (const wake of waiters.splice(0)) wake();
    });
    for (const wake of waiters.splice(0)) wake();
  });
  const url = (await listen(server)).replace(/^http:/, "ws:");
  return {
    url, sessions,
    async waitFor(type, index = 0) {
      for (let tries = 0; tries < 500; tries++) {
        const found = sessions[index]?.received.find((event) => event.type === type);
        if (found) return found;
        await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 20); });
      }
      throw new Error(`the realtime session never sent ${type}`);
    },
    send(event, index = 0) { sessions[index]!.socket.send(JSON.stringify(event)); },
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await closeServer(server);
    },
  };
}

/** Twilio's media stream client: connects to the stream URL from the TwiML and speaks the Media Streams protocol. */
export async function twilioStream(url: string): Promise<{ socket: WebSocket; received: Array<Record<string, unknown>>; waitFor(match: (event: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>; closed: Promise<number> }> {
  const socket = new WebSocket(url);
  const received: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data) => {
    received.push(JSON.parse(data.toString()) as Record<string, unknown>);
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); socket.once("close", () => resolve()); });
  return {
    socket, received, closed,
    async waitFor(match) {
      for (let tries = 0; tries < 500; tries++) {
        const found = received.find(match);
        if (found) return found;
        await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, 20); });
      }
      throw new Error("the stream never got that message");
    },
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
  }));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
