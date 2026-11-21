// Who a call is for and why: what the bot gave in place_call, else About you in Settings, else the profile name.
import type { CallCaller, CallInfoSource } from "../../shared/phone-calls.ts";
import { realName } from "./prompt.ts";

export interface CallerInput {
  purpose?: string;
  callType?: "business" | "owner";
  onBehalfOf?: string;
  bookingName?: string;
  callbackNumber?: string;
  details?: string;
}

export interface CallerSettings {
  userName?: string;
  callbackNumber?: string;
  aboutMe?: string;
}

const clean = (value: string | undefined, max: number) => value?.replace(/\s+/g, " ").trim().slice(0, max) || undefined;

/** The first name that is really a name, and where it came from. */
function firstName(candidates: ReadonlyArray<[string | undefined, CallInfoSource]>): { name?: string; from: CallInfoSource } {
  for (const [raw, from] of candidates) {
    const name = realName(raw);
    if (name) return { name: name.slice(0, 80), from };
  }
  return { from: "none" };
}

/** The name a call uses when the bot gives none: About you, else the profile name. */
export function defaultName(settings: CallerSettings, profileName: string | undefined): { name?: string; from: CallInfoSource } {
  return firstName([[settings.userName, "settings"], [profileName, "profile"]]);
}

export function resolveCaller(input: CallerInput, settings: CallerSettings, profileName: string | undefined): CallCaller {
  const user = firstName([[input.onBehalfOf, "call"], [settings.userName, "settings"], [profileName, "profile"]]);
  const booking = firstName([[input.bookingName, "call"]]);
  const callCallback = clean(input.callbackNumber, 40);
  const settingsCallback = clean(settings.callbackNumber, 40);
  const callback = callCallback ? { number: callCallback, from: "call" as const } : settingsCallback ? { number: settingsCallback, from: "settings" as const } : { from: "none" as const };
  const aboutMe = settings.aboutMe?.trim().slice(0, 2_000);
  const details = [input.details?.trim().slice(0, 2_000), aboutMe ? `About ${user.name ?? "the person you represent"}: ${aboutMe}` : undefined].filter(Boolean).join("\n");
  const purpose = clean(input.purpose, 200);
  return {
    callType: input.callType === "owner" ? "owner" : "business",
    ...(purpose ? { purpose } : {}),
    ...(user.name ? { userName: user.name } : {}),
    userNameFrom: user.from,
    ...(booking.name ? { bookingName: booking.name } : user.name ? { bookingName: user.name } : {}),
    bookingNameFrom: booking.name ? "call" : user.from,
    ...("number" in callback ? { callbackNumber: callback.number } : {}),
    callbackNumberFrom: callback.from,
    ...(details ? { details } : {}),
    aboutMeIncluded: Boolean(aboutMe),
  };
}
