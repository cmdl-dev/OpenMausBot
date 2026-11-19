/** Which engine a Router model runs on: Claude Code for Anthropic's models, Codex for the rest. */
export type RouterEngine = "claude" | "codex";

/** A connected Router (a CLIProxyAPI gateway) as Settings shows it; its API key and management key are write-only. */
export interface RouterView {
  id: string;
  label: string;
  url: string;
  /** A management key is saved, so the Router's accounts show their usage. */
  usage: boolean;
  engines: { instanceId: string; engine: RouterEngine; models: number }[];
}

/** Set on an engine a Router added: Settings manages it with its Router, not as an account of its own. */
export interface InstanceRouterInfo {
  router?: { id: string; label: string };
}
