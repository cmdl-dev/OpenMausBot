import { attachmentUrlPath, composeMessage, readMessageAttachments } from "@/api/attachments";

test("files ride after the words as the desktop composer's tags, with their attributes escaped", () => {
  const text = composeMessage("  Here are the receipts ", [
    { kind: "image", path: "/data/attachments/abc.jpg", name: "receipt.jpg" },
    { kind: "file", path: "/data/files/q4.pdf", name: 'Q4 "final" <v2>.pdf' },
  ]);
  expect(text).toBe(
    'Here are the receipts\n\n<attached-image path="/data/attachments/abc.jpg" name="receipt.jpg" />\n\n' +
      '<attached-file path="/data/files/q4.pdf" name="Q4 &quot;final&quot; &lt;v2&gt;.pdf" />',
  );
  expect(readMessageAttachments(text)).toEqual({
    text: "Here are the receipts",
    attachments: [
      { kind: "image", path: "/data/attachments/abc.jpg", name: "receipt.jpg" },
      { kind: "file", path: "/data/files/q4.pdf", name: 'Q4 "final" <v2>.pdf' },
    ],
  });
});

test("a photo with no words is just its tag; plain text has no attachments", () => {
  expect(composeMessage("", [{ kind: "image", path: "a.png", name: "a.png" }])).toBe('<attached-image path="a.png" name="a.png" />');
  expect(readMessageAttachments("just words")).toEqual({ text: "just words", attachments: [] });
});

test("a stored image is fetched by its file name only", () => {
  expect(attachmentUrlPath("/Users/x/.openmausbot/attachments/7f3a-1.png")).toBe("/api/attachments/7f3a-1.png");
  expect(attachmentUrlPath("C:\\data\\attachments\\b.jpg")).toBe("/api/attachments/b.jpg");
});
