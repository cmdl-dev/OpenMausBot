import { createSseParser, type SseEvent } from "@/api/sse";

function parse(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  const parser = createSseParser((event) => events.push(event));
  chunks.forEach((chunk) => parser.push(chunk));
  return events;
}

test("reads ids and data, across chunk boundaries", () => {
  expect(parse(["id: s:1\nda", "ta: {\"kind\":\"hello\"}\n", "\n"])).toEqual([{ id: "s:1", data: '{"kind":"hello"}' }]);
});

test("skips heartbeat comments and joins multi-line data", () => {
  expect(parse([": keepalive\n\n", "data: a\ndata: b\n\n"])).toEqual([{ id: undefined, data: "a\nb" }]);
});

test("accepts CRLF, including a CR split from its LF", () => {
  expect(parse(["data: x\r", "\n\r\n"])).toEqual([{ id: undefined, data: "x" }]);
});

test("holds an event until its blank line arrives", () => {
  expect(parse(["data: unfinished\n"])).toEqual([]);
});

test("names the event type when the stream gives one", () => {
  expect(parse(['event: frame\ndata: {"seq":1}\n\n', "data: plain\n\n"])).toEqual([
    { id: undefined, event: "frame", data: '{"seq":1}' },
    { id: undefined, data: "plain" },
  ]);
});
