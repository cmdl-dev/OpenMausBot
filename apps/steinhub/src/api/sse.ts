export interface SseEvent {
  id?: string;
  data: string;
}

/** Incremental `text/event-stream` reader: feed it text as it arrives, get each complete event once. */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";
  let data: string[] = [];
  let id: string | undefined;

  function line(text: string) {
    if (text === "") {
      if (data.length) onEvent({ id, data: data.join("\n") });
      data = [];
      id = undefined;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? "" : text.slice(colon + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      let newline = buffer.search(/\r\n|\r|\n/);
      while (newline !== -1) {
        const breakLength = buffer.startsWith("\r\n", newline) ? 2 : 1;
        if (buffer[newline] === "\r" && breakLength === 1 && newline === buffer.length - 1) break;
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + breakLength);
        newline = buffer.search(/\r\n|\r|\n/);
      }
    },
  };
}
