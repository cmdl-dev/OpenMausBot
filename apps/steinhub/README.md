# SteinHub

The iOS and Android companion app for OpenMausBot: Expo SDK 58, React Native
0.88, Expo Router. Dark only, following the mockups in [`designs/`](designs/).

SteinHub pairs with a computer's OpenMausBot companion (six-digit code or QR)
and talks to it over Wi-Fi, Tailscale or a hosted HTTPS address.
[`docs/connection.md`](docs/connection.md) explains the transport, pairing and
token storage, which screens are live, and what still needs a desktop change.
Development builds also have a demo mode with the sample world, under
**Settings → Development**. It is on until a phone is paired.

## Run it

From the repository root, after `pnpm install`:

```sh
pnpm steinhub:start     # Metro; scan with Expo Go or press i / a
pnpm steinhub:ios       # open in the iOS Simulator through Expo Go
pnpm steinhub:android   # open in an Android emulator through Expo Go
pnpm steinhub:check     # tsc, oxlint and jest
```

For a native development build use `pnpm --filter @openmausbot/steinhub run:ios`
(or `run:android`). `ios/` and `android/` are generated and not committed.

## Layout

| Path | What |
|---|---|
| `src/api/` | The client layer: transport, typed routes, event stream, pairing, secure session storage, error sentences. |
| `src/state/` | The connection provider, the live world reducer, and the views the screens draw. |
| `src/app/` | Routes. `(drawer)/` holds everything reached from the left drawer; `onboarding` sits outside it. |
| `src/components/` | Top bars, composer, drawer content, list rows, buttons, avatars, badges. |
| `src/theme/` | Typed tokens from `designs/tokens.md`: colour, type, spacing, radius, sizes, motion. |
| `src/sample/world.ts` | The sample world from `designs/README.md`, shown in demo mode. |
| `designs/` | Approved HTML mockups and tokens. Open `designs/index.html`. |

Shared wire types and helpers come from
[`packages/phone-protocol`](../../packages/phone-protocol) (for example the
pairing-code reader on the onboarding screen and the inbox row type).

App identifiers: `com.cmdl.steinhub` on both platforms, URL scheme `steinhub`.
