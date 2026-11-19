const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_ONLY = /^ {0,3}(`{3,}|~{3,})\s*$/;

function closes(line: string, fence: string): boolean {
  const run = FENCE_ONLY.exec(line)?.[1];
  return Boolean(run && run[0] === fence[0] && run.length >= fence.length);
}

/**
 * The part of a streaming reply whose blocks are finished: everything before the last blank line
 * outside a code fence. The block still being written stays back, so a half-made table, list or
 * bold run never reaches the screen.
 */
export function settledMarkdown(text: string): string {
  let fence: string | null = null;
  let settled = 0;
  let offset = 0;
  let afterContent = false;
  for (const line of text.split("\n")) {
    const end = offset + line.length + 1;
    const lineEnded = end <= text.length;
    const opener = FENCE.exec(line)?.[1];
    if (fence) {
      if (lineEnded && closes(line, fence)) fence = null;
      afterContent = true;
    } else if (opener) {
      fence = opener;
      afterContent = true;
    } else if (line.trim()) {
      afterContent = true;
    } else {
      if (afterContent && lineEnded) settled = offset;
      afterContent = false;
    }
    offset = end;
  }
  return text.slice(0, settled).trimEnd();
}
