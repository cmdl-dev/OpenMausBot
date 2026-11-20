# How SteinHub talks to OpenMausBot

SteinHub talks to a computer's **companion**: the sidecar in
[`companion/`](../../../companion) that sits in front of the OpenMausBot
harness. The harness listens only on `127.0.0.1:8799`. The companion listens
on the network (port `8810` by default), checks the phone's token, lets
through only the routes in its allowlist, and forwards those to the harness
over loopback. The desktop app starts and stops it from **Settings → Phone &
devices** ("Remote access"). On a headless machine, `pnpm companion` starts it
by hand.

```text
SteinHub ──HTTP (LAN / tailnet) or HTTPS (hosted)──▶ companion :8810 ──loopback──▶ harness :8799
```

## What the computer exposes

- **Default deny.** [`companion/src/routes.ts`](../../../companion/src/routes.ts)
  lists every method and path a paired device may call. Anything else gets a
  404 (or a 403 with a sentence for a few families, such as `/api/config` writes
  and `/api/webhooks`). A route the harness adds later stays closed to phones
  until someone lists it.
- **The live stream.** `GET /api/events` is server-sent events. Every frame is
  a `ServerFrame` from `phone-protocol/wire.ts`, with an `id:` cursor of the
  form `<stream>:<seq>`. The first frame is always
  `{kind:"hello", cursor, resumed}`. When `resumed` is false, the phone has
  missed frames and must reload everything. SteinHub asks for
  `?screens=off&since=<cursor>`. The server sends a visible frame at least
  every 40 s, so a quiet stream is a dead one.
- **Scrubbing.** The companion strips the harness's provider resume cursors
  and replaces `/api/health` with `{app:"openmausbot"}`.
- **No browsers.** A request that carries an `Origin` header is refused before
  the token is read. SteinHub's `expo/fetch` sends none.

## Transport

| Route | URL the phone dials | Protection |
|---|---|---|
| Wi-Fi (`lan`, `bonjour`) | `http://<LAN IP or name>.local:8810` | None beyond the network. The companion answers only when both ends are private addresses. |
| Tailscale (`tailnet`) | `http://<machine>.<tailnet>.ts.net:8810` | WireGuard, end to end |
| Hosted HTTPS (`hosted`) | `https://…` through the desktop's outbound connector | TLS |
| Encrypted relay (`e2e`) | `wss://relayN.openmausbot.com` (Noise + yamux, `companion/src/e2e`) | End to end. **SteinHub does not speak it yet.** |

A pairing returns every route the computer knows about (`endpoints`, sorted by
priority). SteinHub stores all of them. When the stream can't connect, it moves
to the next address. It also adds routes that arrive later in
`companion.endpoints` frames.

To reach those addresses:

- **iOS:** `app.json` sets `NSAllowsLocalNetworking` (LAN IPs and `.local`) and
  an ATS exception for `ts.net`. It also sets `NSLocalNetworkUsageDescription`.
- **Android:** `expo-build-properties` sets `usesCleartextTraffic`.

A phone that has used the encrypted connection once is refused on the plain
listener with `426 {error:"update_app"}`. SteinHub never uses that connection,
so it can only hit this after re-pairing a device id another app used. It then
asks the person to pair again.

## Pairing, auth and token storage

1. On the computer, **Pair a phone** opens a two-minute window. The window
   holds a six-digit `code` (five wrong guesses close it) and a 43-character
   `omb_pair_…` credential for the QR code.
2. The QR code is
   `openmausbot://pair?address=…&token=omb_pair_…&code=…&name=…&hosts=…&endpoints=…[&secretKey=…][&e2e=…]`,
   built by `phonePairingLink` in `phone-protocol/pairing-link.ts`.
   SteinHub reads it with `readPairingLink` (`src/api/pairing.ts`), using
   `qrEndpoints` from the protocol to check the endpoint list. Its tests build
   links with the protocol's own `phonePairingLink`.
3. When typing by hand, the person enters the **Pairing address** and
   **Pairing code** from the desktop's Pair a phone → Having trouble? panel
   (`host[:port]`, where the port defaults to 8810). The code can be the
   companion's six digits or a 12-character code like `7KQ2-M9XD-H4TP`: the
   harness's own `POST /api/pair` takes the same request and accepts it. A
   pasted link fills in both fields: the QR link (`openmausbot://pair?…`) or a
   server's sign-in link (`https://host:port/pair#code=…`, also `?code=`).
   A refused code sends the person back to enter a new one instead of
   resending it.
4. `POST /api/pair` with `PairRequest`
   `{credential, deviceName, pairRequestId, replacesToken?}` returns
   `PairResponse` `{token, device, serverName, endpoints?}`. A refusal carries
   a `PairingErrorCode`, and SteinHub picks its sentence from that code. When
   re-pairing, SteinHub sends the old token as `replacesToken`, so the
   computer replaces the old device instead of adding a second one.
5. **The token** goes in `Authorization: Bearer …` on every request. The
   computer stores only its SHA-256. On the phone, `src/api/session.ts` keeps
   `{token, urls, serverName, device, pairedAt}` in `expo-secure-store` with
   `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so it never reaches a backup or
   another device. A 401 means the computer removed this phone, and the app
   offers **Pair again**.

The mockup shows a second confirmation, **Allow**, on the desktop. The
protocol has no such step: holding a valid code is the consent. The confirm
screen shows the QR code's six digits so the person can compare them.

## The client layer (`src/api`)

| File | What |
|---|---|
| `transport.ts` | `expo/fetch` with the bearer token. Maps status codes to `DesktopError` kinds (`offline`, `signed-out`, `update-app`, `refused`, `starting`, `server`, `bad-reply`). Streams response bodies. |
| `sse.ts` | Incremental `text/event-stream` parser |
| `client.ts` | One typed function per allowlisted route SteinHub uses. Types come from `phone-protocol`. |
| `live-events.ts` | The stream loop. On a non-resumed `hello` it loads a snapshot and holds new frames until that's done. It retries with backoff (0.5 s doubling to 10 s), drops a stream silent for 40 s, stops on 401 or 426, and reconnects when the app comes back to the foreground. |
| `pairing.ts` | Link and typed-code readers, and `pair()` across the candidate addresses |
| `session.ts` | Secure storage, plus the dev-only demo-mode choice |
| `errors.ts` | `problemText()`: every failure as one sentence in the app's voice (what happened, then what to do) |

`src/state/live-world.ts` folds snapshots and frames into one state.
`src/state/views.ts` turns wire types into the view models the screens draw.
`src/state/world.ts` hands screens either those views or the sample world. In
development builds, **Settings → Development → Demo mode** switches to the
sample world. The switch starts on until a phone is paired, and release builds
don't have it.

## What each screen shows

| Screen | Source now | Routes |
|---|---|---|
| Onboarding: welcome, scan QR, typed code, confirm | **Live** | `POST /api/pair` |
| Home: bots, greeting, new chat | **Live** (no person's name; see gaps) | `GET /api/bots`, `GET /api/instances` (model labels), `POST /api/bots/:id/tasks`, `POST /api/bots/:id/messages` |
| Composer: attach (Camera, Photos, Files) and dictation | **Live** for attachments: `POST /api/attachments` (photos) and `POST /api/files?name=` (files) as raw bytes, then `<attached-image/>` / `<attached-file/>` tags in the message, as the desktop composer writes them. Dictation runs on the phone (`expo-speech-recognition`, on-device when the phone supports it) and only fills in the message field. | |
| Drawer bot menu: new thread, new folder (name, emoji), pin, mark as read, copy conversation ID, delete | **Live** | `POST /api/bots/:id/tasks` (`projectId`), `POST /api/bots/:id/projects`, `PATCH /api/bots/:id {pinned}`, `POST /api/bots/:id/read`, `DELETE /api/bots/:id` |
| Bot picker, drawer bots (in the computer's sidebar sections, each drawn as its mascot or picture) and recent threads | **Live** | `GET /api/bots` (`sections`), `GET /api/attachments/:file` (pictures), `bot` / `bot.deleted` / `bots.order` / `sections` frames |
| Chat thread: history (Markdown through `react-native-enriched-markdown`, hand-off chips with their replies), send, streamed reply, Stop | **Live** | `GET /api/threads/:id/messages`, `POST /api/bots/:id/messages`, `POST /api/bots/:id/interrupt`, `message` / `message.patch` / `runtime` (`content.delta`) frames |
| Chat approval and question cards | **Live** | `POST /api/threads/:id/respond` `{requestId, behavior: allow, deny or answer}` |
| Chat widget cards (the daily brief, a bot's `show_widget` forms and lists): text, rows, fields and buttons drawn natively | **Live**. A link opens in the phone's browser and Open opens that chat on the phone; every other button is a press the computer answers | `POST /api/bots/:id/messages` `{threadId, sendId, widgetAction: {messageId, ref, rev, values?}}` |
| Chat sign-in cards: Open (the bot's own browser), Done (a sign-in elsewhere), Cancel, and how each ended | **Live** | `POST /api/bots/:id/sign-in-cards/:message/(done\|cancel)` `{threadId}`, `message.patch` frames |
| Browser: a bot's live browser, from a sign-in card or the bot profile; watch, Take control, then tap to click, drag to scroll, pinch to zoom, type through the phone's keyboard; Give back (on a sign-in it answers the card, so the bot carries on) | **Live**. The page keeps the size it has: a phone asks for none, since a page taller than the computer's screen is emulated and a navigation then stops the view's frames | `GET /api/bots/:id/browser/live?threadId=` (server-sent events, `phone-protocol/browser-live.ts`), `POST /api/bots/:id/browser/action?threadId=` |
| Automations list and detail (switch, Run now, Pause/Resume, run history) | **Live** | `GET /api/routines` (routines and runs), `PATCH /api/routines/:id {enabled}`, `POST /api/routines/:id/run`, `routine` / `routine.run` frames |
| Apps: connected apps with their accounts, then every app that can be added, searchable; Connect, Add account (named) | **Live**. The sign-in itself finishes in the phone's browser, and the row waits for the new account | `GET /api/connectors/catalog`, `GET /api/connectors/connected`, `GET /api/connectors?services=`, `POST /api/connectors/:slug/authorize {alias?}` |
| Computers | **Partly live**: the paired computer (name, version, bot count, connection state) | `GET /api/companion/endpoints` |
| Settings, Pairing section | **Live**: computer, app version, pairing date, this phone, re-pair, unpair (forgets locally) | stored session |
| Bot profile | **Live** header, model, Browser, Phone calls and threads; New chat starts one with that bot | `GET /api/bots` |
| Memory: the bot's MEMORY.md, its topic notes and daily notes, read-only | **Live** from a server the phone paired with directly; the desktop companion refuses it, and the screen says so | `GET /api/bots/:id/memory`, `GET /api/bots/:id/memory/file?path=` |
| Phone calls: a bot's calls from its profile, then one call's brief and transcript (who spoke, when), read-only | **Live** | `GET /api/calls`, `GET /api/calls/:id` |
| Inbox: lines, Approve and Deny on approval cards, Mark all as read, open a line's conversation | **Live** from a server the phone paired with directly, read again on `notify` frames and when the screen shows. **Sample data**, with a note and nothing to press, from a computer that serves none (the desktop companion) | `GET /api/inbox`, `POST /api/inbox/read-all`, `POST /api/threads/:id/respond` |
| Drawer search | **Live**: filters the conversations already loaded by title and bot name | none |
| New automation | **Live**: a new chat with the Chief of Staff, drafted "Set up an automation that " | `POST /api/bots/:id/messages` |
| Other computers | Sample, with a note | none (see gaps) |

## Gaps that need desktop changes

These are proposals. Nothing here changes desktop or server code.

1. **Inbox and memory through the companion.** A server the phone paired with
   directly serves `GET /api/inbox`, `POST /api/inbox/read-all` and
   `GET /api/bots/:id/memory[/file]`, but the desktop companion's allowlist has
   none of them, so a phone paired with the desktop app sees the sample inbox
   and no memory. Proposal: add them to `ALLOWED` in `companion/src/routes.ts`,
   and add an `inbox` frame (or reuse `inboxChangedAt` on the task) so the phone
   reloads the inbox without waiting for a `notify` frame.
2. **Other computers.** `GET /api/computers/vps`, `/api/computers/boxes`,
   `/api/shared-computers` and `/api/local-computer` are all closed to phones.
   They also carry addresses and SSH aliases. Proposal: a read-only
   `GET /api/computers/summary` with name, kind, OS, online or asleep, last
   seen, and the bots on each, then list it in the allowlist.
3. **Unpair from the phone.** `/api/devices` is deliberately host-only, so
   **Unpair this phone** only forgets the token locally, and the computer still
   lists the device. Proposal: a sidecar-owned `DELETE /api/pair`. The
   companion would revoke the device that presents the bearer token, and only
   that device, just as the proxy already answers `/api/companion/endpoints`
   itself.
4. **Who the person is.** No phone route returns the profile name, so Home
   greets without a name and the drawer footer shows the computer. Proposal:
   add `profileName` to `CompanionEndpointsSnapshot`. The companion already
   reads that name for its own display name.
5. **Missing protocol types.** `POST /api/bots/:id/messages`
   (`{threadId, message?, queued?, queueId?}`), `GET /api/routines`
   (`{routines, runs}`) and `POST /api/threads/:id/respond` have no type in
   `phone-protocol/responses.ts`. `src/api/client.ts` declares the smallest
   shapes it reads (`SendReply`, `RoutinesReply`). Proposal: add
   `BotMessageResponse` and `RoutinesResponse` to `responses.ts`.
6. **Pairing link reader.** `phonePairingLink` writes the link in
   phone-protocol, but its reader lives in each phone app (`PairingInvite.parse`
   in the native apps, `readPairingLink` here). Proposal: move a
   `readPairingLink` into `pairing-link.ts` beside the builder, with
   round-trip tests.
7. **Away from home without Tailscale.** Phones reach the computer remotely
   through the encrypted relay. A JavaScript Noise and yamux client would let
   SteinHub use it. `companion/src/e2e/phone.ts` and the `v1` vectors are the
   reference. Until then, SteinHub works on the same Wi-Fi, over Tailscale, or
   through a hosted HTTPS endpoint.
8. **Desktop-side Allow.** See the pairing section above. Adding it would be a
   companion change.
9. **Attachment tags.** `composeMessage` and the transcript reader that turn
   uploads into `<attached-image/>` and `<attached-file/>` tags live in the
   desktop's `src/lib/composer-attachments.ts`. SteinHub has its own copy in
   `src/api/attachments.ts`. Proposal: move both into phone-protocol so every
   client writes and reads the same format.
10. **Desktop-only bot actions.** Make Chief of Staff, Move to department,
    Duplicate, Archive and New thread in a working folder are refused to a
    paired device, so the phone's menu leaves them out.
11. **App-event automations.** App-event triggers arrive as `app-trigger`
   frames, but no allowlisted GET lists them, so the list shows scheduled
   routines only.

The phone could already use these, but this phase doesn't wire them:
`GET /api/search` (searching message text, beyond the drawer's titles),
`GET /api/bots/:id/skills` (bot profile), `POST /api/routines` (an automation
form), `PUT /api/push/device` (push alerts, which need APNs and FCM
credentials), and secret and connector cards. Settings shows nothing
for notifications, appearance, a default bot or Face ID until one of them is
built.

## Checking it by hand

[`docs/verification/README.md`](../../../docs/verification/README.md) applies:
pair against an isolated fixture, never the desktop app you use every day.

```sh
node --experimental-strip-types scripts/control-omb.ts launch      # prints http://127.0.0.1:<harness>
OMB_PORT=<harness> OMB_COMPANION_PORT=21810 OMB_CONTROL_PORT=21811 \
  OMB_CONTROL_TOKEN=<43 base64url chars> OMB_COMPANION_DIR=<temp dir> OMB_COMPANION_BONJOUR=0 \
  node --experimental-strip-types companion/src/index.ts
curl -s -X POST -H "x-openmausbot-control-token: <token>" http://127.0.0.1:21811/pairing   # code + token
```

In the simulator, choose **Enter code manually** and type `127.0.0.1:21810`
and the code.
