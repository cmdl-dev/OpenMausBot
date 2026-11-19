// A loopback stand-in for a CLIProxyAPI Router: its client model list and the management API's account list.
//   FAKE_ROUTER_KEY             client API key it accepts (default fake-router-key)
//   FAKE_ROUTER_MANAGEMENT_KEY  management key it accepts (default fake-router-management-key)
// Prints {"url": "..."} once listening; the third and later model reads add gpt-6-luna.
import { createServer } from "node:http";

const apiKey = process.env.FAKE_ROUTER_KEY ?? "fake-router-key";
const managementKey = process.env.FAKE_ROUTER_MANAGEMENT_KEY ?? "fake-router-management-key";
let reads = 0;

const server = createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const auth = req.headers.authorization;
  if (req.url === "/v1/models") {
    if (auth !== `Bearer ${apiKey}`) return send(401, { error: "invalid api key" });
    reads++;
    return send(200, { object: "list", data: [
      { id: "claude-sonnet-5-5", object: "model", owned_by: "anthropic" },
      { id: "claude-opus-5-5", object: "model", owned_by: "anthropic" },
      { id: "gpt-6.1-sol", object: "model", owned_by: "openai" },
      { id: "gpt-image-2", object: "model", owned_by: "openai" },
      { id: "muse-spark-1.3", object: "model", owned_by: "meta" },
      ...(reads > 2 ? [{ id: "gpt-6-luna", object: "model", owned_by: "openai" }] : []),
    ] });
  }
  if (req.url?.startsWith("/v0/management/")) {
    if (auth !== `Bearer ${managementKey}`) return send(401, { error: "invalid management key" });
    if (req.url === "/v0/management/auth-files") {
      return send(200, { files: [{ id: "codex-owner.json", auth_index: "1", provider: "codex", email: "owner@example.test" }] });
    }
    if (req.url === "/v0/management/api-call") return send(200, { status_code: 200, body: "{}" });
  }
  send(404, { error: "not found" });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}` }));
});
