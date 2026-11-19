import { settledMarkdown } from "@/state/settled-markdown";

test("holds back the paragraph still being written", () => {
  expect(settledMarkdown("First paragraph.\n\nSecond is **half")).toBe("First paragraph.");
  expect(settledMarkdown("Only one paragraph so far")).toBe("");
  expect(settledMarkdown("Ends its line\n")).toBe("");
  expect(settledMarkdown("Done.\n\n")).toBe("Done.");
});

test("shows a table only once the blank line after it arrives", () => {
  const table = "| Item | Cost |\n|---|---|\n| Rent | $2,450 |";
  expect(settledMarkdown(`Intro.\n\n${table}\n`)).toBe("Intro.");
  expect(settledMarkdown(`Intro.\n\n${table}\n\nAfter`)).toBe(`Intro.\n\n${table}`);
});

test("a blank line inside an open code fence is not a boundary", () => {
  const open = "Run this:\n\n```sh\necho one\n\necho two\n";
  expect(settledMarkdown(open)).toBe("Run this:");
  expect(settledMarkdown(`${open}\`\`\`\n\nThen`)).toBe(`${open}\`\`\``);
  expect(settledMarkdown("~~~~\n```\n\n~~~~\n\nx")).toBe("~~~~\n```\n\n~~~~");
});
