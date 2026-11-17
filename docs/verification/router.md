# Routers

A Router is a CLIProxyAPI gateway holding the person's Claude and ChatGPT
sign-ins. Connecting one in Settings → Engines → Router adds a Claude engine
and a Codex engine that run through it on its API key. Each is listed as a
**Router** account under Claude and under OpenAI in the model picker. With a
management key, the Router's accounts also show their usage. This recipe uses
the disposable fixture, the fake Claude CLI and a loopback fake Router. It
never calls a real Router or provider.

## Launch

In one terminal, start the fake Router and keep its printed `url` as `$R`:

```sh
node --experimental-strip-types server/testing/fake-router.ts
```

It accepts the client key `fake-router-key` and the management key
`fake-router-management-key`. Its `/v1/models` lists two Anthropic models, one
OpenAI chat model, one OpenAI image model and one `meta` model. From the third
read on, it also lists `gpt-6-luna`.

In a second terminal, start the fixture and keep its printed `url` as `$URL`
and `dataDir` as `$D`:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
```

## HTTP and turn evidence

1. `POST $URL/api/routers` with `{"url":"$R","apiKey":"nope"}` answers 400:
   "The Router refused the API key…". Nothing is saved.
2. `POST $URL/api/routers` with `{"url":"$R/v1","apiKey":"fake-router-key"}`
   answers 201.
   - `routers[0]` is labelled `Router`, with `url` = `$R` (the `/v1` is cut)
     and `usage: false`.
   - It has two engines: `router-<id>-claude` with 2 models and
     `router-<id>-codex` with 2 models. The image model is left out.
   - Both engines have `access: "subscription"`, `router: {id, label}`, no
     `claudeEndpoint` or `codexEndpoint`, and model options without `custom`.
   - The Claude engine is `available` and `authenticated` with
     `billing: "subscription"`. The fixture has no `codex` CLI, so the Codex
     engine says "`codex` CLI not found".
   - Neither this answer nor `GET $URL/api/instances` contains
     `fake-router-key`.
3. Create a bot on `router-<id>-claude` with model `claude-opus-5-5`, send a
   message and wait for idle. `$D/fake-claude-dump.json` shows:
   - `ANTHROPIC_BASE_URL` = `$R`;
   - `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` set to the Router key;
   - `CLAUDE_CONFIG_DIR` = `$D/providers/router-<id>-claude`;
   - `--model claude-opus-5-5`.
4. `DELETE $URL/api/instances/router-<id>-claude` answers 400 and says the
   account belongs to a Router. `DELETE $URL/api/routers/<id>` answers 409
   while the bot uses it.
5. `PATCH $URL/api/routers/<id>` with `{"managementKey":"wrong"}` answers 400.
   With `{"label":"Home router","managementKey":"fake-router-management-key"}`
   it answers 200 and `usage: true`.
   - `GET $URL/api/plan-usage/hubs` still lists no hubs: a Router's record is
     managed with its Router.
   - `GET $URL/api/plan-usage?refresh=1` has a `Codex (Home router)` row and
     no rows of its own for the two Router engines.
6. `PATCH $URL/api/routers/<id>` with only a new `url` answers 400: "Enter
   the Router's API key again for the new address."
7. `POST $URL/api/routers/<id>/refresh` adds `gpt-6-luna` to the Codex
   engine. `$D/usage-hubs.json` and `$D/config.json` are mode 600.
8. Move the bot to `claude`, then `DELETE $URL/api/routers/<id>`. It answers
   200 with no routers and no Router engines. `$D/usage-hubs.json` has no
   hubs.

## Codex's own sign-in through config.toml

A Codex account whose `config.toml` makes a custom provider the default
(`model_provider = "router"` with its own `auth` command, `env_key` or bearer
token) runs turns without a ChatGPT login. codex-cli 0.166.0's
`codex login status` still says "Not logged in". The account shows as signed
in, with its provider's name and "API key", and lists only that provider's
models: official rows would run on OpenAI's provider, which needs a login the
account doesn't have. The fake Codex CLI covers this in
`server/drivers/codex.test.ts` ("counts a config.toml provider…" and "still
asks for a sign-in when config.toml's provider needs OpenAI's").

## Regression suites

```sh
pnpm exec vitest run --no-file-parallelism server/routers.test.ts server/router-api.test.ts server/usage-hubs.test.ts server/drivers/codex.test.ts src/components/RouterSettings.dom.test.ts
pnpm typecheck
pnpm i18n:check
pnpm lint
```

## Limitations

This proves the wiring, the key handling and the API behaviour against a fake
Router and the fake Claude CLI. A Codex turn through a Router is not run here,
because the fixture installs no Codex CLI. `server/router-api.test.ts` checks
its saved settings, and the Codex driver's endpoint tests check the launch
arguments. The Settings card is driven by its DOM test and by hand;
`control-omb` cannot drive Settings yet. Run one real turn on each engine by
hand against your own Router before relying on it.
