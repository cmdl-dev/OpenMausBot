/** A file sent with a message, after the computer stored it. */
export interface SentAttachment {
  kind: "image" | "file";
  path: string;
  name: string;
}

/** File paths are untrusted prompt content: they stay inside the quoted attribute. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

function unescapeAttribute(value: string): string {
  return value
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&#9;", "\t")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/** The message text the desktop composer sends: the words, then one `<attached-image/>` or `<attached-file/>` tag per
 * file, which the computer turns into the bot's view of the file. */
export function composeMessage(text: string, attachments: readonly SentAttachment[]): string {
  const tags = attachments.map(
    (file) => `<attached-${file.kind} path="${escapeAttribute(file.path)}" name="${escapeAttribute(file.name)}" />`,
  );
  return [text.trim(), ...tags].filter(Boolean).join("\n\n");
}

const TAG = /<attached-(image|file) path="([^"]*)" name="([^"]*)" \/>/g;

/** A sent line split back into its words and the files it carried. */
export function readMessageAttachments(text: string): { text: string; attachments: SentAttachment[] } {
  const attachments: SentAttachment[] = [];
  const words = text.replace(TAG, (_tag, kind: "image" | "file", path: string, name: string) => {
    attachments.push({ kind, path: unescapeAttribute(path), name: unescapeAttribute(name) });
    return "";
  });
  return { text: words.trim(), attachments };
}

/** Where a stored image is served: the attachment route by its file name, never by path. */
export function attachmentUrlPath(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").pop() ?? "";
  return `/api/attachments/${encodeURIComponent(name)}`;
}
