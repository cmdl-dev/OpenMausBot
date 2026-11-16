export const CODEX_TASK_SECONDS: number;
export function codexAppAnswer(response: unknown): { action: "decline" } | { action: "accept"; content: Record<string, string> };
export function runCodexTask(options: {
  prompt: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  /** Gets each app-access question Codex sends and resolves with the answer the person gave on the server. */
  ask: (request: unknown) => Promise<unknown>;
  /** For tests: the command and arguments to start instead of `codex app-server`. */
  launch?: [string, string[]];
  env?: NodeJS.ProcessEnv;
}): Promise<{ content: Array<{ type: "text"; text: string }> }>;
