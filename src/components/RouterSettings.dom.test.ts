// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const connected = { id: "r1", label: "Home router", url: "https://router.example:8317", usage: false,
  engines: [{ instanceId: "router-r1-claude", engine: "claude", models: 2 }, { instanceId: "router-r1-codex", engine: "codex", models: 3 }] };
const fixture = vi.hoisted(() => ({
  sent: [] as Array<{ path: string; method: string; body?: Record<string, string> }>,
  routers: [] as unknown[],
  bots: [] as unknown[],
}));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { instances: [], bots: fixture.bots }, dispatch: () => {} }),
  api: async (path: string, init?: { method?: string; body?: string }) => {
    fixture.sent.push({ path, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
    return { routers: fixture.routers };
  },
}));
import { RouterSettings } from "./RouterSettings";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.sent = [];
  fixture.routers = [];
  fixture.bots = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(field).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("connects a Router with its address and API key, the management key left out when empty", async () => {
  await act(async () => root.render(createElement(RouterSettings)));
  await act(async () => button("Connect a Router")!.click());
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Router");
  await input("Address", "https://router.example:8317");
  expect(button("Connect")!.disabled).toBe(true);
  await input("API key", "fixture-router-key");
  await act(async () => button("Connect")!.click());
  expect(fixture.sent.at(-1)).toEqual({ path: "/api/routers", method: "POST", body: { label: "Router", url: "https://router.example:8317", apiKey: "fixture-router-key" } });
});

it("shows each Router's models and usage, keeps saved keys on edit and refuses removal while bots use it", async () => {
  fixture.routers = [connected];
  fixture.bots = [{ modelSelection: { instanceId: "router-r1-codex" } }];
  await act(async () => root.render(createElement(RouterSettings)));
  expect(container.querySelector("[data-router='r1']")!.textContent).toContain("2 Claude models · 3 OpenAI models · No usage");
  expect(button("Remove Home router")!.disabled).toBe(true);
  await act(async () => button("Edit")!.click());
  await input("Management key (optional)", "fixture-management-key");
  await act(async () => button("Save")!.click());
  expect(fixture.sent.at(-1)).toEqual({ path: "/api/routers/r1", method: "PATCH", body: { label: "Home router", url: "https://router.example:8317", managementKey: "fixture-management-key" } });
  await act(async () => button("Refresh Home router's models")!.click());
  expect(fixture.sent.at(-1)).toMatchObject({ path: "/api/routers/r1/refresh", method: "POST" });
});
