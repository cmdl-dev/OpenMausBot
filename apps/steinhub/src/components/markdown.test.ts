import { literalMarkdown } from "@/components/markdown";

test("every symbol is escaped, so nothing typed turns into formatting", () => {
  expect(literalMarkdown("# Not a *heading* [link](x) <b> 1. `code`")).toBe(
    "\\# Not a \\*heading\\* \\[link\\]\\(x\\) \\<b\\> 1\\. \\`code\\`",
  );
  expect(literalMarkdown("a_b & c\\d")).toBe("a\\_b \\& c\\\\d");
});

test("each line break stays a line break, and trailing ones are dropped", () => {
  expect(literalMarkdown("one\ntwo\n\nfour\n\n")).toBe("one\\\ntwo\\\n\\\nfour");
  expect(literalMarkdown("crlf\r\nline")).toBe("crlf\\\nline");
});

test("leading spaces are kept without becoming a code block", () => {
  expect(literalMarkdown("    indented\n\tx")).toBe("    indented\\\n    x");
});
