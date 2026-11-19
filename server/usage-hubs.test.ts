import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanAccount, PlanProviderRow } from "./plan-usage.ts";
import { clearHubUsageCache, hubBaseUrl, loadHubUsage, UsageHubStore, withHubRows, type HubFetch, type UsageHub } from "./usage-hubs.ts";

const KEY = "hub-management-fixture-key";
const HUB_URL = "https://router.test:14443";

interface Sent { url: string; method: string; headers: Record<string, string>; body?: unknown }

function fakeHub(options: { refuse?: boolean; claudeStatus?: number } = {}) {
  const sent: Sent[] = [];
  const fetch: HubFetch = async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    sent.push({ url, method: init.method, headers: init.headers, body });
    const answer = (status: number, value: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
    if (options.refuse || init.headers.Authorization !== `Bearer ${KEY}`) return answer(401, { error: "bad key" });
    if (url === `${HUB_URL}/v0/management/auth-files`) {
      return answer(200, { files: [
        { id: "claude-a.json", auth_index: "1", provider: "claude", email: "a@example.com", access_token: "never-shown" },
        { id: "codex-b.json", auth_index: "2", provider: "codex", email: "b@example.com", id_token: { chatgpt_account_id: "acct-b" } },
        { id: "claude-off.json", auth_index: "3", provider: "claude", disabled: true },
        { id: "meta.json", auth_index: "4", provider: "meta" },
      ] });
    }
    if (url === `${HUB_URL}/v0/management/api-call`) {
      if (body.auth_index === "1") {
        const status = options.claudeStatus ?? 200;
        return answer(200, { status_code: status, body: JSON.stringify({ five_hour: { utilization: 21, resets_at: "2030-01-01T05:00:00Z" }, seven_day: { utilization: 47, resets_at: "2030-01-05T00:00:00Z" } }) });
      }
      return answer(200, { status_code: 200, body: JSON.stringify({ plan_type: "pro", rate_limit: {
        primary_window: { used_percent: 10, reset_at: 1_893_456_000, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 8, reset_at: 1_893_900_000, limit_window_seconds: 604_800 },
      } }) });
    }
    return answer(404, {});
  };
  return { fetch, sent };
}

const hub: UsageHub = { id: "h1", label: "Router", url: HUB_URL, managementKey: KEY };
let dir: string;

beforeEach(() => {
  clearHubUsageCache();
  dir = mkdtempSync(join(tmpdir(), "omb-usage-hubs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("usage hubs", () => {
  it("lists each enabled Claude and Codex account with its windows, read through the hub's api-call", async () => {
    const { fetch, sent } = fakeHub();
    const rows = await loadHubUsage([hub], { fetch });
    expect(rows.map((row) => [row.name, row.plan, row.ok, row.fiveHour.usedPercent, row.weekly.usedPercent])).toEqual([
      ["Claude (Router)", "a@example.com", true, 21, 47],
      ["Codex (Router)", "pro · b@example.com", true, 10, 8],
    ]);
    const calls = sent.filter((entry) => entry.url.endsWith("/api-call")).map((entry) => entry.body as { url: string; header: Record<string, string> });
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/api/oauth/usage", header: { Authorization: "Bearer $TOKEN$" } });
    expect(calls[1]).toMatchObject({ url: "https://chatgpt.com/backend-api/wham/usage", header: { "Chatgpt-Account-Id": "acct-b" } });
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(JSON.stringify(rows)).not.toContain("never-shown");
  });

  it("turns a refused key or an expired account into a row that says so", async () => {
    expect((await loadHubUsage([hub], { fetch: fakeHub({ refuse: true }).fetch })).map((row) => [row.name, row.error])).toEqual([["Router", "The hub refused the management key."]]);
    clearHubUsageCache();
    const rows = await loadHubUsage([hub], { fetch: fakeHub({ claudeStatus: 401 }).fetch });
    expect(rows[0]).toMatchObject({ ok: false, error: "This account's sign-in on the hub has expired. Sign in again on the hub." });
    expect(rows[1]?.ok).toBe(true);
  });

  it("saves a hub only after its key lists accounts, and never shows the key", async () => {
    const store = new UsageHubStore(dir);
    await expect(store.add({ label: "Router", url: `${HUB_URL}/v1`, managementKey: "wrong" }, fakeHub().fetch)).rejects.toThrow("refused the management key");
    expect(store.views()).toEqual([]);
    const view = await store.add({ label: "Router", url: `${HUB_URL}/v1/`, managementKey: KEY }, fakeHub().fetch);
    expect(view).toEqual({ id: expect.any(String), label: "Router", url: HUB_URL });
    expect(JSON.stringify(store.views())).not.toContain(KEY);
    const file = join(dir, "usage-hubs.json");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).hubs[0].managementKey).toBe(KEY);
    expect(store.remove(view.id)).toBe(true);
    expect(store.views()).toEqual([]);
  });

  it("cuts a pasted API or management address back to the hub", () => {
    expect(hubBaseUrl("https://router.test:14443/v1")).toBe(HUB_URL);
    expect(hubBaseUrl(" https://router.test:14443/v0/management/ ")).toBe(HUB_URL);
    expect(() => hubBaseUrl("https://user:pw@router.test")).toThrow("own field");
    expect(() => hubBaseUrl("ftp://router.test")).toThrow("https://");
  });

  it("drops a gateway Claude account's sign-in row when a hub on that host lists its accounts", () => {
    const failed = (id: string): PlanProviderRow => ({ id, name: "Claude", driver: "claude", plan: null, ok: false, error: "Sign in again in Claude",
      fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null }, weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null }, extra: [], models: [] });
    const accounts: PlanAccount[] = [
      { id: "claude", name: "Claude", driver: "claude", environment: { ANTHROPIC_BASE_URL: "https://router.test:14443" } },
      { id: "other", name: "Claude", driver: "claude", environment: { ANTHROPIC_BASE_URL: "https://elsewhere.test" } },
      { id: "plain", name: "Claude", driver: "claude", environment: { CLAUDE_CODE_OAUTH_TOKEN: "x" } },
    ];
    const env = { HOME: dir };
    const rows = withHubRows([failed("claude"), failed("other"), failed("plain")], accounts, [hub], [], env);
    expect(rows.map((row) => [row.id, row.error])).toEqual([
      ["other", "Reaches Claude through elsewhere.test. Add that gateway below as a usage hub to see its accounts."],
      ["plain", "Sign in again in Claude"],
    ]);
  });
});
