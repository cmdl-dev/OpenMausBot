// The call listener: the only thing the public address reaches. It answers Twilio's webhooks (TwiML, call progress,
// answering-machine detection), each checked against Twilio's signature, and takes the call's media stream, which must
// carry the call's own token. Every other path is 404, so exposing it exposes nothing else of OpenMausBot.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer } from "ws";
import { CALLS_PATH, type Calls } from "./manager.ts";
import { answeredByMachine, formParams, twilioProgress, validTwilioSignature } from "./twilio.ts";

const MAX_BODY_BYTES = 64 * 1024;
const ROUTE = new RegExp(`${CALLS_PATH}/(answer|status|machine)/(c-[0-9a-f-]{36})$`);
const STREAM = new RegExp(`${CALLS_PATH}/stream/(c-[0-9a-f-]{36})/([0-9a-f]{48})$`);

export interface CallIngressDeps {
  calls(): Calls;
  /** The auth token webhooks are signed with, and the public address they were sent to; null while calls aren't set up. */
  signing(): { authToken: string; publicUrl: string } | null;
  log(line: string): void;
}

export interface CallIngress {
  listen(port: number, host?: string): Promise<number>;
  listening(): boolean;
  port(): number | null;
  close(): Promise<void>;
  server: Server;
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The URL Twilio was given for this request: the public address plus the path from /calls/twilio on. */
function signedUrl(publicUrl: string, rawUrl: string): string {
  const url = new URL(rawUrl, "http://listener");
  const at = url.pathname.indexOf(CALLS_PATH);
  return `${publicUrl}${url.pathname.slice(at)}${url.search}`;
}

export function createCallIngress(deps: CallIngressDeps): CallIngress {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  let boundPort: number | null = null;

  const reply = (res: ServerResponse, status: number, body = "", type = "text/plain") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://listener").pathname;
    const match = ROUTE.exec(path);
    if (req.method !== "POST" || !match) return reply(res, 404);
    const signing = deps.signing();
    if (!signing) return reply(res, 503);
    const body = await readBody(req);
    if (body === null) return reply(res, 413);
    const params = formParams(body);
    const signature = req.headers["x-twilio-signature"];
    if (!validTwilioSignature(signing.authToken, signedUrl(signing.publicUrl, req.url ?? "/"), params, typeof signature === "string" ? signature : undefined)) {
      deps.log(`call webhook refused: bad signature on ${path}`);
      return reply(res, 403);
    }
    const [, action, id] = match;
    const one = (name: string) => (typeof params[name] === "string" ? (params[name] as string) : undefined);
    const calls = deps.calls();
    switch (action) {
      case "answer":
        return reply(res, 200, calls.answer(id!), "text/xml");
      case "status":
        calls.status(id!, { CallStatus: one("CallStatus"), CallDuration: one("CallDuration") }, twilioProgress);
        return reply(res, 204);
      default:
        calls.machine(id!, answeredByMachine(one("AnsweredBy")));
        return reply(res, 204);
    }
  }

  function upgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const match = STREAM.exec(new URL(req.url ?? "/", "http://listener").pathname);
    if (!match || !deps.signing()) {
      socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      if (!deps.calls().stream(match[1]!, match[2]!, ws)) {
        deps.log(`call stream refused for ${match[1]}`);
        ws.close(1008, "not this call");
      }
    });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      deps.log(`call webhook failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) reply(res, 500);
      else res.destroy();
    });
  });
  server.on("upgrade", (req, socket, head) => upgrade(req, socket as Socket, head));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  return {
    server,
    listen(port, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once("error", failed);
        server.listen(port, host, () => {
          server.off("error", failed);
          const address = server.address();
          boundPort = address && typeof address === "object" ? address.port : port;
          resolve(boundPort);
        });
      });
    },
    listening: () => server.listening,
    port: () => boundPort,
    close() {
      for (const client of sockets.clients) client.terminate();
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
