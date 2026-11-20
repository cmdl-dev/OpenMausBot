// What a telephony provider does for a call. The manager, tools and cards see only CallProvider, so another provider
// (Telnyx) can stand in for Twilio without changing them.
import type { CallEndReason } from "../../shared/phone-calls.ts";

export interface PlaceCall {
  to: string;
  from: string;
  /** Where the provider fetches what to do once the call is answered. */
  answerUrl: string;
  /** Where the provider posts the call's progress. */
  statusUrl: string;
  /** Where the provider posts whether a person or a machine answered. */
  machineUrl: string;
  /** Hard cap the provider enforces, in seconds. */
  timeLimitSeconds: number;
  /** How long it rings before giving up, in seconds. */
  ringSeconds: number;
}

/** A provider's view of a call's progress, in our words. */
export type ProviderProgress =
  | { kind: "ringing" }
  | { kind: "answered" }
  | { kind: "ended"; reason: CallEndReason; seconds?: number }
  | { kind: "other" };

export interface CallProvider {
  readonly name: "twilio";
  place(call: PlaceCall): Promise<{ providerCallId: string }>;
  hangUp(providerCallId: string): Promise<void>;
  /** The call's progress as the provider has it now: the fallback when its callbacks don't arrive. */
  progress(providerCallId: string): Promise<ProviderProgress>;
}

export class CallProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    if (status !== undefined) this.status = status;
  }
}
