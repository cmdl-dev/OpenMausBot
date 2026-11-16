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
  /** One line per step with its time since the start; never the job's words. */
  log?: (line: string) => void;
}): Promise<{ content: Array<{ type: "text"; text: string }> }>;
