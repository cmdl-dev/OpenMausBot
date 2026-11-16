import type { PairingErrorCode } from "@openmausbot/phone-protocol/pairing-code.ts";

export type ProblemKind =
  | "offline"
  | "signed-out"
  | "update-app"
  | "refused"
  | "starting"
  | "server"
  | "bad-reply"
  | "pairing";

export class DesktopError extends Error {
  readonly kind: ProblemKind;
  readonly status?: number;
  readonly pairing?: PairingErrorCode;

  constructor(kind: ProblemKind, message: string, options: { status?: number; pairing?: PairingErrorCode } = {}) {
    super(message);
    this.name = "DesktopError";
    this.kind = kind;
    this.status = options.status;
    this.pairing = options.pairing;
  }
}

export function asDesktopError(error: unknown): DesktopError {
  if (error instanceof DesktopError) return error;
  return new DesktopError("offline", error instanceof Error ? error.message : String(error));
}

const PAIRING_TEXT: Partial<Record<PairingErrorCode, string>> = {
  pairing_code_wrong: "That code didn't match. Check the six digits on the computer and try again.",
  pairing_not_open:
    "Pairing isn't open on the computer. Open Settings → Phone & devices there, choose Pair a phone, and try again.",
  pairing_too_many: "Too many wrong codes. Choose Pair a phone on the computer again for a new code.",
  pairing_link_expired: "That code has expired. Choose Pair a phone on the computer again for a new code.",
  pairing_device_limit:
    "The computer already has as many phones as it allows. Remove an old one in Settings → Phone & devices, then try again.",
  pairing_qr_only: "This computer pairs over this connection only with its QR code. Scan the code instead.",
};

/** The sentence a screen shows for a failed request: what happened, then what to do. */
export function problemText(error: unknown, computer = "the computer"): string {
  const problem = asDesktopError(error);
  switch (problem.kind) {
    case "offline":
      return `Couldn't reach ${computer}. Check that it's on and that this phone is on the same Wi-Fi or tailnet, then try again.`;
    case "signed-out":
      return `${computer} no longer knows this phone. Pair it again from Settings → Phone & devices on the computer.`;
    case "update-app":
      return `${computer} only accepts this phone over its encrypted connection, which SteinHub doesn't use. Pair this phone again.`;
    case "refused":
      return `${computer} doesn't let phones do that. Do it on the computer instead.`;
    case "starting":
      return `${computer} is still starting. Try again in a moment.`;
    case "server":
      return `Something went wrong on ${computer}. Try again.`;
    case "bad-reply":
      return `${computer} sent a reply SteinHub couldn't read. Update OpenMausBot on the computer and try again.`;
    case "pairing":
      return (
        (problem.pairing && PAIRING_TEXT[problem.pairing]) ??
        "The computer couldn't finish pairing. Choose Pair a phone on the computer again and try once more."
      );
  }
}
