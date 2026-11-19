// AES-256-GCM sealing for files kept at rest under a key of their own (saved logins, mailboxes): nonce, body, tag.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function sealKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

export function unsealText(data: Buffer, key: string): string {
  if (data.length < 29) throw new Error("Sealed data is too short.");
  const decipher = createDecipheriv("aes-256-gcm", sealKey(key), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString("utf8");
}

export function sealText(text: string, key: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(key), nonce);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}
