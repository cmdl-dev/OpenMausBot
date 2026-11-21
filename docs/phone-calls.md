# Phone calls

A bot can phone someone for you: a restaurant, a doctor's office, a shop. The bot
writes a brief, you approve the call, and an OpenAI Realtime voice talks to the
person from that brief over Twilio. A card in the conversation follows the call
(dialing, ringing, on the call, ended) with a **Hang up** button. When the call
ends, the bot gets the transcript and posts a summary in the chat.

Every call:

- waits for your tap on **Send on your behalf?**, whatever the bot's sending rule
  or access level;
- opens with Twilio saying *"Hi, this is an AI assistant calling on behalf of
  &lt;name&gt;. This call is transcribed."* before the voice speaks;
- ends after **10 minutes** by default (the voice is asked to wrap up 45 seconds
  before the limit);
- hangs up when voicemail or an answering machine picks up, without leaving a
  message;
- keeps a speaker-labelled, timestamped transcript (AI voice, callee, notes) in
  `~/.openmausbot/calls/`. The bot reads it as outside data, never as
  instructions.

The bot's tools are `place_call`, `call_status`, `hang_up` and
`get_call_transcript`. They appear once any phone call setting is saved, and the
person can turn them off per bot (Settings → Access → Tools → Phone calls).
Until every setting is in place, `place_call` and Settings → Phone calls name
exactly what is missing.

## Settings

| What | Settings label | `config.json` | Environment variable |
| --- | --- | --- | --- |
| Twilio Account SID (`AC…`) | Settings → API keys → Twilio Account SID | `calls.accountSid` | `OMB_TWILIO_ACCOUNT_SID` |
| Twilio auth token | Settings → API keys → Twilio auth token | `calls.authToken` | `OMB_TWILIO_AUTH_TOKEN` |
| Caller ID number, E.164 (`+14155550123`) | Settings → Phone calls → Caller ID number | `calls.callerId` | `OMB_CALLS_CALLER_ID` |
| OpenAI API key (the existing one is reused) | Settings → API keys → OpenAI | `openai.key` | `OMB_OPENAI_API_KEY` |
| Public address (https) | Settings → Phone calls → Public address | `calls.publicUrl` | `OMB_CALLS_PUBLIC_URL` |
| Max call minutes (1–60, default 10) | Settings → Phone calls | `calls.maxMinutes` | `OMB_CALLS_MAX_MINUTES` |
| Realtime model (default `gpt-realtime-2.1-mini`) | Settings → Phone calls | `calls.model` | `OMB_CALLS_REALTIME_MODEL` |
| Voice (default `marin`; `cedar` is the other recommended one) | Settings → Phone calls | `calls.voice` | `OMB_CALLS_VOICE` |
| Reasoning effort (default `low`; `minimal`, `medium`, `high`), sent only to reasoning models | Settings → Phone calls | `calls.reasoningEffort` | |
| Allowlist (numbers or prefixes like `+1415*`) | Settings → Phone calls | `calls.allow` | `OMB_CALLS_ALLOW` (comma separated) |
| Denylist (wins over the allowlist) | Settings → Phone calls | `calls.deny` | `OMB_CALLS_DENY` (comma separated) |
| Your name, the name the voice gives (optional) | Settings → Phone calls → About you → Your name | `calls.userName` (an earlier `calls.onBehalfOf` counts while it is empty) | `OMB_CALLS_ON_BEHALF_OF` |
| Callback number the voice may give (optional) | Settings → Phone calls → About you → Callback number | `calls.callbackNumber` | |
| About me, what the voice may share (optional) | Settings → Phone calls → About you → About me | `calls.aboutMe` | |
| Call listener port (default 8805) | Settings → Phone calls | `calls.port` | `OMB_CALLS_PORT` |
| Transcription model (default `gpt-transcribe`) | Settings → Phone calls | `calls.transcriptionModel` | |
| Turn detection (default semantic VAD, eagerness `auto`; server VAD with threshold 0.6, 300 ms padding, 700 ms silence when chosen) | Settings → Phone calls | `calls.turnDetection` | |
| Noise reduction (default `near_field`) | Settings → Phone calls | `calls.noiseReduction` | |
| Voice turns without a reply before it says goodbye and hangs up (default 3) | Settings → Phone calls | `calls.maxTurnsWithoutReply` | |
| Record calls on this computer (default on) | Settings → Phone calls → Record calls | `calls.record` | |
| Speak disclosure (default on) | Settings → Phone calls → What the call says → Speak disclosure | `calls.disclosureEnabled` | |

## What a call says

Every text a call sends is shown and editable in Settings → Phone calls → What
the call says, with a Reset to default button each. A saved text is used exactly
as written, with nothing added before or after; only its `{placeholders}` are
filled: `{forUser}` ("for <your name>", or "for a client" when no name is known),
`{userName}` (the name, or empty), `{purpose}` (or "help with a quick request"),
`{bookingName}` (or `{userName}`, or empty), `{callbackNumber}` (or empty),
`{details}` (the bot's details, then About me labelled, or empty), `{callType}`
(`business` or `owner`), `{callTypeNote}` (one sentence saying which),
`{onBehalfOf}` (kept for texts saved earlier: the name, or "a client"),
`{callee}` (the name, or "the person you called"),
`{calleeName}`, `{to}`, `{botName}`, `{brief}`, `{disclosure}`,
`{maxMinutes}`, `{recordingNotice}` ("This call is recorded." while
recording is on, else "This call is transcribed.") and `{disclosureHeard}`
(while Speak disclosure is on: `When they answered, they heard: "<the
disclosure>" Don't repeat it.`; while it is off: `Nothing was said to them
before you spoke; they haven't been told this call is from an AI assistant.`).
The default instructions use `{disclosureHeard}`, so they never claim the
callee heard a disclosure that wasn't spoken. `{disclosure}` and
`{recordingNotice}` work in the opening too, for a voice that says it itself.

With Speak disclosure off, Twilio says nothing when the callee answers: the
TwiML is only `<Connect><Stream>`, the call's audio reaches the voice at once,
and no disclosure line is written into the transcript. The saved disclosure
text is kept. In California every party has to agree to a call being
recorded, and the TCPA restricts calls placed with an artificial voice; the
switch is the owner's decision.

| Text | `config.json` | Sent |
| --- | --- | --- |
| Disclosure | `calls.disclosure` | Spoken by Twilio's `<Say>` when the callee answers |
| Instructions | `calls.instructions` | OpenAI Realtime session instructions |
| Opening | `calls.opening` | The first response's instructions, sent once |
| Closing | `calls.closing` | When the voice tries to hang up without having said goodbye; the call hangs up after it |
| Wrap-up | `calls.wrapUp` | A system message 45 seconds before the time limit |
| Goodbye | `calls.goodbye` | After that many voice turns with nothing from the callee; the call then hangs up |
| Default brief | `calls.defaultBrief` | `{brief}` when a bot gave none |
| end_call description | `calls.endCallDescription` | The description of the tool the voice hangs up with |

The rest of the Realtime session (audio format, turn detection, the end_call
tool's definition) is shown read-only on the same screen. Each call keeps exactly
what it sent; it is in the call's details and in `get_call_transcript`. A call's
voice events (turns, interruptions, empty transcriptions) are logged to
`~/.openmausbot/calls/<call id>.events.jsonl`, never with audio.

On the desktop app the Account SID and auth token are stored encrypted like
every other API key. With no settings at all the server starts normally and
offers no call tools; `GET /api/calls/setup` lists what is missing.

A non-empty allowlist admits only the numbers it names. The denylist always
wins. A bot can't call the caller ID number itself, and runs one call at a time.

## Who the call is for

`place_call` takes, besides the number and the brief:

| Field | What it is |
| --- | --- |
| `purpose` | Why it calls, in a few words the voice says after "I'm calling to": "book a haircut this Sunday". The tool asks the bot to always give it. |
| `call_type` | `business` (default: a shop, an office, anyone but you) or `owner` (calling you yourself). The opening is `calls.opening` for business calls and `calls.openingOwner` for owner calls. |
| `on_behalf_of` | The name the voice gives. |
| `booking_name` | The name for a booking, when it differs. |
| `details` | Dates, times, acceptable options and facts the voice may share. |
| `callback_number` | A number the voice may give. |

The bot fills `on_behalf_of` from what it knows (the chat, its memory, your
name in OpenMausBot). If a call books or reserves something and it doesn't
know your name, it asks you first and saves the answer with its memory tool,
`memory_update`, so it knows next time.

Each name or number comes from the call, else About you in Settings, else your
profile name, else nowhere. With no name the voice says it is calling "for a
client" and never invents one; "the person I work for" is never said. A call's
details and `get_call_transcript` show each value and where it came from.

The approach follows what others do: Google Duplex says "I'm calling to book
a women's haircut for a client" and gives a first name when asked; Gemini's
Call for Me says it is an AI calling on your behalf with your name, after you
review the name and contact details; Grok's assistant says it is "a virtual
assistant calling for <name> on a recorded line"; Vapi, Retell and Bland fill
`{{name}}`-style variables into the first message and the prompt.

## The voice

The built-in texts follow OpenAI's Realtime prompting guide: short labelled
sections (role, brief, tone, language, conversation, variety, preambles,
unclear audio, entity capture, safety, ending the call), sample phrases, and
no turn-taking wording. Turn-taking comes from turn detection: a model told
to "stop and wait" says so out loud. A saved text that is exactly an earlier
built-in default counts as unset, so it moves to the current default; a text
you changed stays as you wrote it.

The voice says the opening once. Until the opening has been said, the
session holds automatic replies and interruptions back, so a "Hello?" the
instant the callee answers neither starts a second greeting nor cuts the
first; a second `session.update` then turns them on as configured. Both are
in the call's details.

The voice never hangs up without a spoken goodbye: if it calls end_call
without one, it is asked for the closing first, and the call hangs up once
that has played. After the set number of voice turns with no words from the
callee it says the goodbye text and hangs up.

| Model | Audio in / out per 1M tokens | About a minute of the callee / of the voice |
| --- | --- | --- |
| `gpt-realtime-2.1-mini` (default) | $10 / $20 | $0.006 / $0.024 |
| `gpt-realtime-2.1` (best quality) | $32 / $64 | $0.019 / $0.077 |

OpenAI counts about 600 audio tokens a minute for what the callee says and
1,200 for what the voice says; the conversation so far is also read again on
each reply, mostly at the cached rate. Any other Realtime model id can be
typed in. GPT-Live (`gpt-live-1.1`, billed per minute) is a different API and
isn't used for calls.

## Recordings

With Record calls on, OpenMausBot records every call itself from the audio
already passing through the call listener: the callee's side and the voice's,
placed on one timeline and mixed into one WAV (16-bit PCM, 8 kHz, mono). Voice
audio that the callee talked over and Twilio dropped is left out. Nothing uses
Twilio's recording, so it costs nothing extra. The disclosure Twilio speaks
when the callee answers comes before the audio stream starts, so it isn't in
the recording; it is the first line of the transcript.

Recordings are written while the call runs to
`~/.openmausbot/calls/recordings/<call id>.wav` (folder 700, file 600) and
finalized when it ends; one cut short by a crash is repaired at the next start.
They play and download from the call's details in the app and SteinHub, through
`GET /api/calls/<call id>/recording` (signed-in app routes only, with Range for
seeking, `?download=1` to save). The public call listener never serves them.
Deleting a call (`DELETE /api/calls/<call id>`, or Delete call in its details)
deletes its recording, transcript and event log. While Record calls is on, the
default disclosure says "This call is recorded."

## Twilio

1. Create a Twilio account and copy the **Account SID** and **Auth token** from
   the Console's front page into Settings → API keys.
2. Pick the caller ID:
   - **A number you already own** (your mobile, say): Console → Phone Numbers →
     Manage → **Verified Caller IDs** → *Add a new Caller ID*. Twilio calls or
     texts it with a code. Once verified, enter it in E.164 form as the Caller
     ID number.
   - Or a Twilio number bought on the account (Phone Numbers → Buy a number).
3. Console → Voice → Settings → **Geo permissions**: turn on each country you
   want to call.
4. A **trial** account can only call verified numbers and plays a trial notice
   before every call; upgrade the account for normal calls.

Twilio errors come back to the bot in plain words (an unverified caller ID, a
trial account calling an unverified number, a country turned off, a wrong
token).

## The public address

Twilio has to reach OpenMausBot from the internet: it fetches what to do when
the callee answers, posts the call's progress, and opens a WebSocket that
carries the call's audio. OpenMausBot answers these on a **separate call
listener** on `127.0.0.1:8805` (change it with `calls.port`). That listener
answers only these paths and returns 404 for everything else, so exposing it
exposes nothing else of OpenMausBot:

| Path | Kind | Check |
| --- | --- | --- |
| `/calls/twilio/answer/<call id>` | HTTP POST (returns TwiML) | `X-Twilio-Signature` |
| `/calls/twilio/status/<call id>` | HTTP POST | `X-Twilio-Signature` |
| `/calls/twilio/machine/<call id>` | HTTP POST | `X-Twilio-Signature` |
| `/calls/twilio/stream/<call id>/<token>` | WebSocket | the call's one-time 48-hex token |

Expose **only port 8805**, never the app's own port (8799) or the webhook port
(8800). Forward paths unchanged and keep WebSockets on. The public address you
enter is the https origin that reaches the listener, e.g.
`https://calls.example.com`.

### Cloudflare Tunnel (recommended on the Mac mini)

A named tunnel keeps a stable hostname. With a domain on Cloudflare:

```sh
cloudflared tunnel login
cloudflared tunnel create omb-calls
cloudflared tunnel route dns omb-calls calls.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: omb-calls
credentials-file: /Users/<you>/.cloudflared/<tunnel id>.json
ingress:
  - hostname: calls.example.com
    service: http://127.0.0.1:8805
  - service: http_status:404
```

Then `cloudflared tunnel run omb-calls` (or `sudo cloudflared service install`
to start it at boot) and set the public address to `https://calls.example.com`.
Cloudflare passes WebSockets through by default. A quick tunnel
(`cloudflared tunnel --url http://127.0.0.1:8805`) works for a test, but its
`trycloudflare.com` address changes every time it starts.

The `cloudflared` already running on the Mac mini belongs to T3 Code; leave it
alone and run this one as its own tunnel.

### Tailscale Funnel

Funnel publishes one of the ports 443, 8443 or 10000 of the machine's
`ts.net` name, and makes **everything served on that port public**. On the Mac
mini all three already carry tailnet-only Serve mounts (443 → T3 Code, 8443 and
10000 → other local services), so turning Funnel on for any of them would
publish those too. Use Funnel only on a port with nothing else on it, for
example after moving one of those mounts:

```sh
tailscale funnel --bg --https=10000 http://127.0.0.1:8805
```

and set the public address to `https://<machine>.<tailnet>.ts.net:10000`.

## Checking it

- Settings → Phone calls shows **Ready**, or the missing settings and the env
  variable for each.
- `curl https://calls.example.com/calls/twilio/status/x` should answer `404`
  (the listener is reachable and refuses anything that isn't a call path).
- Ask a bot to call your own mobile. Approve the card, answer, and talk to it.
  After you hang up, the bot posts a summary; the transcript is under
  Settings → Phone calls → Call history.

## Putting this branch on the Mac mini

The Mac mini runs the packaged desktop app built from
`/Users/cmdl/work/OpenMausBot-codex` (main). To run this branch there:

1. Quit OpenMausBot (menu bar → Quit), so nothing is mid-turn.
2. In `/Users/cmdl/work/OpenMausBot-codex`: `git fetch origin` and
   `git checkout feat/phone-calls` (or merge it into main once reviewed), then
   `pnpm install --frozen-lockfile`.
3. `pnpm package:mac` and open the new
   `release/mac-arm64/OpenMausBot.app` (the data in `~/.openmausbot` stays).
4. Settings → API keys: Twilio Account SID, Twilio auth token (OpenAI is already
   there if Live calls work). Settings → Phone calls: Caller ID number and
   Public address.
5. Start the tunnel to port 8805 and check it as above.

To go back, check out main again and rebuild; the `calls` settings are ignored
by builds without phone calls.

## Not yet

- Telnyx: the provider sits behind `CallProvider` (`server/calls/provider.ts`);
  only Twilio is implemented.
- Incoming calls.
- Leaving a voicemail message.
