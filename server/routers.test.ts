import { describe, expect, it } from "vitest";
import type { InstanceConfigMap } from "./contracts.ts";
import { applyRouter, readRouterModels, routerAddress, routerApiKey, routerEngineId } from "./routers.ts";

const router = { id: "r1", label: "Router", url: "https://router.test:8317" };

function answer(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("Routers", () => {
  it("accepts https anywhere and plain http only on this computer", () => {
    expect(routerAddress("https://router.test:8317/v1/")).toBe("https://router.test:8317");
    expect(routerAddress("http://127.0.0.1:8317")).toBe("http://127.0.0.1:8317");
    expect(() => routerAddress("http://router.test:8317")).toThrow(/https/);
  });

  it("explains a refused key, a missing catalog and an empty Router", async () => {
    await expect(readRouterModels(router.url, "k", answer(401, {}))).rejects.toThrow(/refused the API key/);
    await expect(readRouterModels(router.url, "k", answer(404, {}))).rejects.toThrow(/no \/v1\/models/);
    await expect(readRouterModels(router.url, "k", answer(200, { data: [{ id: "gpt-image-2", owned_by: "openai" }] }))).rejects.toThrow(/lists no models/);
  });

  it("keeps an engine's last models when the Router lists none for it, and changes nothing when nothing changed", () => {
    const instances: InstanceConfigMap = { claude: { driver: "claudeAgent", config: { cli: "/bin/claude-fixture" } } };
    expect(applyRouter(instances, router, "key-1", { claude: ["claude-opus-5-5"], codex: [] })).toEqual([routerEngineId("r1", "claude")]);
    expect(instances[routerEngineId("r1", "claude")]).toMatchObject({ config: { cli: "/bin/claude-fixture", endpointModels: ["claude-opus-5-5"] } });
    expect(instances).not.toHaveProperty(routerEngineId("r1", "codex"));
    expect(applyRouter(instances, router, "key-1", { claude: ["claude-opus-5-5"], codex: [] })).toEqual([]);

    instances[routerEngineId("r1", "claude")].hidden = true;
    expect(applyRouter(instances, router, "key-2", { claude: [], codex: ["gpt-6.1-sol"] })).toEqual([routerEngineId("r1", "claude"), routerEngineId("r1", "codex")]);
    expect(instances[routerEngineId("r1", "claude")]).toMatchObject({ hidden: true, config: { endpointModels: ["claude-opus-5-5"] }, environment: { ANTHROPIC_API_KEY: "key-2" } });
    expect(routerApiKey(instances, "r1")).toBe("key-2");
  });
});
