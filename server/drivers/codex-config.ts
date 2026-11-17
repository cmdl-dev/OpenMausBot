import { decodeRoutedCodexConfig, type CodexEndpointConfig } from "./codex-endpoint-config.ts";

export interface CodexConfig {
  cli: string;
  fullAuto: boolean;
  authMode?: "chatgpt-plan";
  managed?: CodexEndpointConfig;
  endpoint?: CodexEndpointConfig;
  /** The Router whose engine this endpoint is: its models are the providers' own, billed to the person's subscriptions. */
  router?: string;
}

export function decodeCodexConfig(raw: unknown): CodexConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.authMode !== undefined && o.authMode !== "chatgpt-plan") throw new Error("Unknown Codex sign-in mode.");
  if (o.authMode && o.managed) throw new Error("ChatGPT plan and Company billing cannot be combined.");
  if (o.endpoint && (o.authMode || o.managed)) throw new Error("Direct API, ChatGPT plan and Company billing cannot be combined.");
  return {
    cli: typeof o.cli === "string" ? o.cli : "codex",
    fullAuto: o.fullAuto === true,
    ...(o.authMode === "chatgpt-plan" ? { authMode: "chatgpt-plan" as const } : {}),
    ...(o.endpoint ? { endpoint: decodeRoutedCodexConfig(o.endpoint as object, "Direct API") } : {}),
    ...(o.managed && typeof o.managed === "object" ? { managed: decodeRoutedCodexConfig(o.managed) } : {}),
    ...(typeof o.router === "string" && o.router && o.endpoint ? { router: o.router } : {}),
  };
}
