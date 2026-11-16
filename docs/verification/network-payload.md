# What crosses the network

## Sub-features

- A remote client's `/api/events` stream is gzipped when the client sends
  `Accept-Encoding: gzip`. Remote replies are the ones on:
  - the phone tunnel;
  - MausBot Relay;
  - a LAN or tailnet peer;
  - any request a proxy forwarded to the loopback listener, such as
    `tailscale serve`, which keeps the Host and sets `X-Forwarded-For`;
  - the companion's own listeners.

  The stream is flushed after every event. On TLS hops all events share one
  compression window. On MausBot Relay's sealed hop each event gets a window
  of its own. Loopback and Caddy-fronted streams are sent as before.
- A remote client's large JSON replies are gzipped on the same listeners.
- Every `GET` that answers 200 with JSON carries a weak `ETag` and
  `Cache-Control: private, no-cache`, unless the route sets its own. A request
  whose `If-None-Match` names the tag gets an empty `304` with the same
  `Vary`.
  - A browser revalidates this way by itself when it reaches the server
    directly, through Caddy, or through the phone tunnel.
  - The companion forwards no `If-None-Match`, drops the harness's tag and
    marks its replies `no-store`. A phone through the desktop always gets the
    full body, gzipped.
- A stream is never sent a `bot` frame that repeats the one it was last sent
  for that bot. This is judged on each stream's own narrowed frame, so a Team
  Cloud member still hears a conversation shared with them.

## Driving it

```sh
pnpm exec vitest run server/network-payload.e2e.test.ts server/phone-relay.e2e.test.ts server/harness/event-stream.test.ts server/harness/tunnel-gzip.test.ts server/sse-fanout.test.ts server/tailnet-listener.test.ts companion/test/tunnel-gzip.test.ts companion/test/large-json.test.ts
```

`server/network-payload.e2e.test.ts` launches the isolated fixture with a
tailnet stand-in: one of the runner's own non-loopback addresses, as in
[Tailscale](tailscale.md). It pairs a client there and runs three fake-engine
turns while a remote stream and a loopback stream watch. Its assertions:

1. The two streams decode to the same frames in the same order.
2. The remote wire carries under a quarter of the loopback bytes.
3. No `bot` frame repeats its bot's previous state.
4. The remote stream drops, a fourth turn runs, and the stream comes back with
   `Last-Event-ID`. It resumes, gets every missed frame that is not a `bot`
   frame, and its bot ends in the loopback stream's state.
5. A repeated `GET /api/bots?messages=200` with the returned `ETag` answers an
   empty `304`.

`server/phone-relay.e2e.test.ts` checks that a large reply through MausBot
Relay goes gzipped.

### Last exercised

2026-11-16: three turns sent 79 frames, 22 of them `bot` frames. They took
53,310 bytes on loopback and 5,049 bytes on the remote wire.

## Gotchas

- The gzip window is 32 KB. A frame larger than that cannot reference the
  frame before it.
- A change that leaves a bot as it was (a `PATCH` to the value it already
  has) sends no frame. A client whose own optimistic change failed without a
  word is set right by its next real change, its own `PATCH` reply, or a
  reconnect, never by an echo.
- A screen frame is already PNG. Gzip only takes back the base64 overhead,
  and while the stream is backed up the frame is dropped, as before.
- Known open risk: on a TLS hop, an attacker who can inject text (an email, a
  page) and watch record sizes could learn other words in the shared window,
  as with permessage-deflate. The sealed relay hop does not share windows
  between events for this reason.
- This proves the server's and the companion's wire format against Node's
  HTTP client. It does not prove the iOS and Android apps. Those decode
  `Content-Encoding: gzip` through URLSession and OkHttp, which inflate
  streamed bodies as they arrive. Check a paired phone over the desktop's
  hosted address before release.
