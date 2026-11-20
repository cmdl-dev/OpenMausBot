# The bots' browser

Every bot's browser runs on OpenMausBot's own Chrome driver (`server/browser/`):
OpenMausBot starts Chrome itself, over a pipe, in a profile of its own for each
bot, shared profile or temporary browser. Nothing else is bundled, downloaded or
installed for it but Chrome. Browser access is on by default, both for the
workspace (Settings) and for each bot (its computer panel); switching either off
withholds the browser.

## Which Chrome

Chosen once per machine (`server/browser/chrome/resolve.ts`) and never switched
while the server runs:

1. The Chrome `OMB_CHROME_PATH` names. The Docker image names its own Chrome for
   Testing this way. A headless shell, or a path that does not exist, gives no
   browser, and the reason says why.
2. The person's installed **Google Chrome**, unless an organization manages it
   (`/Library/Managed Preferences/com.google.Chrome.plist`, the
   `HKLM\SOFTWARE\Policies\Google\Chrome` key, or a JSON file in
   `/etc/opt/chrome/policies/managed`). Bots get profiles of their own; the
   person's Chrome profile is never touched. A Google Chrome that cannot start
   headless gives way to Chrome for Testing where one is pinned.
3. On a Linux server, the root-owned copy of the pinned Chrome for Testing at
   `/opt/openmausbot-browser/chrome-VERSION/chrome`. The service's root step
   installs it where AppArmor blocks Chrome's sandbox
   ([deploy-vps](deploy-vps.md#ubuntu-2404-browser-sandbox)).
4. **Chrome for Testing** 153.0.8010.47, downloaded once into `tools/chrome/` in
   the data directory, checked against its pinned size and SHA-256 before it is
   unpacked, and moved into place in one rename. Only Apple silicon Macs and
   Linux servers on x64 or arm64 have a pin (`scripts/pin-chrome-for-testing.ts`
   measures more). A browser call made during the download waits up to 45
   seconds, then says how far it got. A server needs `unzip` for it.
5. Otherwise there is no bot browser: Windows, Intel Macs and Linux desktops
   without Google Chrome. Settings, the bot's Access settings and its Browser
   panel say so, and that installing Google Chrome, then restarting
   OpenMausBot, fixes it.

When Chrome cannot start, the browser reports why instead of using another one:
the host blocks Chrome's sandbox (AppArmor on Ubuntu 23.10+, with the steps in
[deploy-vps](deploy-vps.md#ubuntu-2404-browser-sandbox)), libraries are missing
(with the command that installs them), or a container refused the sandbox
(`server/browser/chrome/host-setup.ts`).

`openmausbot browser status`, the server's startup log and the
`browserEngine.chrome` field of its configuration status name the choice, for
example `Google Chrome 155 (installed)`.

**Sandbox.** Chrome keeps its own sandbox, except in a container (`/.dockerenv`
or `/run/.containerenv`), when OpenMausBot runs as root, or under CI: a
sandboxed Chrome cannot start there, and the container is the isolation
boundary. `OMB_BROWSER_SANDBOX=0` is an operator's explicit opt-out anywhere
else. On a Team Cloud each member's Chrome runs outside the bot box (see
[team-cloud](team-cloud.md)).

**Identity.** The chosen Chrome reports exactly what it reports headed, read
from the binary itself once per version: its own user agent without
"HeadlessChrome", and its own client hints, on every page, frame and worker.
The primary display's size, the language (`OMB_BROWSER_LANG`, then the app's)
and on a server its `TZ` follow; `OMB_BROWSER_SCREEN`, `OMB_BROWSER_LANG` and
`OMB_BROWSER_TIMEZONE` override them. A bot's Chrome never touches the person's
keychain or keyring.

## Servers

```sh
sudo openmausbot browser install --with-deps   # Chrome's Debian/Ubuntu libraries and unzip, with apt, once
openmausbot browser install                    # as the user running serve: gets Chrome ready
openmausbot browser status
```

`--with-deps` installs the Docker image's list of libraries
(`server/browser/chrome/libraries.ts`), taking the `t64` names Ubuntu 24.04 and
Debian 13 use where the host offers them.

## The Docker image

The image carries Chrome for Testing at `/opt/openmausbot-browser/chrome`
(`OMB_CHROME_PATH`), fetched by a build stage of its own for the image's CPU
(`scripts/prepare-chrome.ts`) and checked against its pinned digest, with
Chrome's libraries in the runtime stage.

## From agent-browser

The bots' browsers ran on agent-browser before. On its first start a server
deletes what that engine left (`server/browser/old-engine-cleanup.ts`): its
profiles (`agent-browser-profiles/` in the data directory), its key, launcher
and binary there, and its encrypted saved sessions and config in
`~/.agent-browser`. Anything else under `~/.agent-browser` is left, since a
person may run agent-browser themselves. Bots sign in to sites again. A profile
that used **My Chrome** (the person's own running Chrome) now opens in a Chrome
profile of its own, like any other shared profile, and `browserEngine.engine` and
`browserEngine.attachCdpUrl` in `config.json` are ignored. The signed-in sites
list and **Record browser steps** are gone with that engine; steps recorded
before stay readable with their conversation.

## What a bot's browser can reach

Every Chrome OpenMausBot launches for a bot sends all of its connections
through an egress gate: a SOCKS5 server on `127.0.0.1`, one per browser
session, run by the OpenMausBot server (`server/browser/egress/`). The gate
resolves names itself and checks every address a name resolves to before it
connects, so redirects and DNS rebinding reach nothing it would refuse. It
carries bytes only, so TLS, HTTP/2 and WebSockets are unchanged. Chrome sends
loopback traffic through it too (`--proxy-bypass-list=<-loopback>`), and
WebRTC sends no UDP around it. If the gate is not running, the browser
connects nowhere.

The owner can set an optional unauthenticated SOCKS5 upstream in Settings →
Bot desktops → Built-in browser. The gate still resolves and checks every
destination locally, then passes only a checked public IP to that proxy; local,
private, own-service, link-local and metadata destinations are never sent
through it. New connections use the saved proxy immediately. The built-in browser also follows the
app's language setting for its Chrome locale and `Accept-Language`; an explicit
`OMB_BROWSER_LANG` environment value takes precedence.

| Destination | Desktop | Self-hosted server | MausBot Cloud |
|---|---|---|---|
| Public internet | yes | yes | yes |
| OpenMausBot's own ports (loopback and this machine's addresses) | no | no | no |
| Other ports on this computer | yes, by `localhost` or an address, not by a public name | only servers a bot's own processes opened (Linux), or allowed below; with "Open sites on this server" on, yes, by `localhost`, an address or a name that points at this server's own addresses, not a public name that points at loopback | only servers a bot's own processes opened |
| Local network: 10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7 | yes, unless `browserEngine.egress.localNetwork` is `false` | only what `browserEngine.egress.allow` lists, or all of it with "Open sites on this server" on | no |
| Link-local and cloud metadata (169.254/16, fe80::/10, `fd00:ec2::254`, 100.100.100.200) | no | no | no |
| 0/8, 198.18/15, multicast | no | no | no |

OpenMausBot's own ports are the server's and its webhook receiver's, the
desktop client relay, the companion and its control page and gateway, the Vite
dev server, the Local VM viewer, every port the server process has listened
on, the ports the desktop app reports and each gate. Servers add their HTTPS edge (8080),
Caddy's admin API (2019) and the ports of fleet workspaces.

"A bot's own processes" means a process in the session of an engine running
a bot's turns, so a dev server the bot started keeps counting after the shell
that started it exits. Other platforms than Linux cannot tell, so there only
allowed destinations are reachable.

A self-hosted server opens more with `config.json`:

```json
{ "browserEngine": { "egress": { "allow": ["192.168.1.0/24", "10.0.0.5:8080", "127.0.0.1:9000"] } } }
```

Each entry is an address or CIDR range with an optional `:port` (IPv6 in
brackets for a port: `[fd12::1]:443`). `localhost` resolves to both loopback
addresses, so `127.0.0.1:9000` also allows `[::1]:9000` and the other way
round, on that port only. OpenMausBot's own ports, metadata and
link-local addresses stay closed whatever it lists, and MausBot Cloud and shared
company workspaces ignore it.

Settings > Computer > "Open sites on this server" (`browserEngine.egress.localNetwork: true`, off by default and
shown only to the server's owner or an admin; not on a shared company workspace, whose network is the operator's) opens this server's own sites and its local network without listing
them. OpenMausBot's own ports, metadata and link-local addresses stay closed, also through a private address such as
a Docker host's gateway, and a public name that resolves to loopback is still refused. It applies to new connections;
a page already open keeps the ones it has until it closes them. Refused connections show up in the bot's next browser result:
the first three by name and the rest as a count (up to 20 per result, each destination and reason once):
`The page tried to reach "127.0.0.1:8799" (blocked: OpenMausBot's own service)`.

`agent_browser_read` reads the page open in the browser and takes no address:
the bot opens the address first. The server never treats a browser as its
owner (see [self-hosting](self-hosting.md#a-browser-signs-in)), and the
companion's control page needs its per-launch token.

## Process hygiene

Each browser is one Chrome process tree that OpenMausBot started. Every minute,
and when the server starts, it closes browsers nothing has used for
`browserEngine.idleTimeoutMinutes` in `config.json` (1 to 60; 10 when unset, 3
on a MausBot Cloud home) and stops any Chrome it started that its registry no
longer owns (`server/browser/chrome/processes.ts`). A turn that holds the
browser, a bot call, or a person using it through a Browser panel keeps it
open; a panel that only watches does not. Saved sign-ins stay, and the bot's
next call opens it again and is told its pages are gone; a temporary browser
saves nothing. Deleting a bot or a profile stops its browser and erases its
profile folder, for every audience on a Team Cloud.

**Containers.** Chrome's helper processes need something to collect them once
their parent exits, and Chrome needs shared memory. Both Docker compose files
and the Podman one set `init: true` and `shm_size: 512m`; a plain `docker run`
wants `--init --shm-size=512m`. In a container OpenMausBot also passes
`--disable-dev-shm-usage`. On Fly Machines (the Cloud home) Fly's own init runs
as PID 1.
