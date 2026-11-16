import { EXPRESSIONS, FACE_BOX, FACE_CENTRE, MOUTHS, MOUTH_STROKE, mouthFrame, type Ring } from "@openmausbot/phone-protocol/cursor-face-data.ts";
import { MASCOT_BODIES, type MascotBodyId } from "@openmausbot/phone-protocol/mascot-bodies.ts";
import type { MausColor } from "@openmausbot/phone-protocol/wire.ts";
import { memo, useMemo } from "react";
import { SvgXml } from "react-native-svg";

/** The desktop's mascot fills, so a bot looks the same on both. */
const FILLS: Record<MausColor, string> = {
  green: "#009957",
  blue: "#377FE6",
  red: "#D94B52",
  orange: "#E78531",
  purple: "#8057C8",
  cyan: "#0EA5C6",
  pink: "#D84F8B",
  yellow: "#D8A729",
  teal: "#01A492",
  coral: "#E5634E",
  silver: "#A8ADB4",
  chrome: "#B3BAC4",
};
const CHROME_GRADIENT: [string, string, string] = ["#F1F4F7", "#AEB8C3", "#66717E"];
const CHROME_EYES = "#1E2833";
const VIEW_SPAN = FACE_BOX + 30;

function mix(hex: string, toward: string, amount: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) + (((b >> shift) & 0xff) - ((a >> shift) & 0xff)) * amount);
  return `#${[channel(16), channel(8), channel(0)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function gradientFor(color: MausColor): [string, string, string] {
  if (color === "chrome") return CHROME_GRADIENT;
  const fill = FILLS[color] ?? FILLS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
}

const ringPath = (ring: Ring) => `M${ring.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;

function mouthPath(rings: Ring[], spec: number[]): string {
  const frame = mouthFrame(rings, spec);
  const ca = Math.cos(frame.angle);
  const sa = Math.sin(frame.angle);
  const at = (lx: number, ly: number) => [frame.x + lx * ca - ly * sa, frame.y + lx * sa + ly * ca].map((v) => v.toFixed(2)).join(" ");
  return `M${at(-spec[0], 0)} Q${at(0, spec[1])} ${at(spec[0], 0)}`;
}

/** The still, front-facing frame of the desktop's mascot: body, gradient, eyes and mouth in the same geometry. */
export function mascotSvg(input: { body: MascotBodyId; color: MausColor; faceInk?: string }): string {
  const silhouette = MASCOT_BODIES[input.body] ?? MASCOT_BODIES.cursor;
  const [light, mid, dark] = gradientFor(input.color);
  const ink = input.faceInk ?? (input.color === "chrome" ? CHROME_EYES : "#ffffff");
  const rings = EXPRESSIONS[0];
  const { x, y, scale } = silhouette.anchor;
  const anchor = `translate(${x} ${y}) scale(${scale}) translate(${-FACE_CENTRE[0]} ${-FACE_CENTRE[1]})`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 ${VIEW_SPAN} ${VIEW_SPAN}">`,
    `<defs><linearGradient id="g" x1="1" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${light}"/><stop offset="55%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/>`,
    `</linearGradient></defs>`,
    `<g transform="${silhouette.fit}">${silhouette.body.replace(/\{\{GRADIENT\}\}/g, "url(#g)")}</g>`,
    `<g transform="${anchor}">`,
    ...rings.map((ring) => `<path fill="${ink}" d="${ringPath(ring)}"/>`),
    `<path fill="none" stroke="${ink}" stroke-width="${MOUTH_STROKE}" stroke-linecap="round" d="${mouthPath(rings, MOUTHS[0])}"/>`,
    `</g></svg>`,
  ].join("");
}

export const Mascot = memo(function Mascot({ body, color, faceInk, size }: { body: MascotBodyId; color: MausColor; faceInk?: string; size: number }) {
  const xml = useMemo(() => mascotSvg({ body, color, faceInk }), [body, color, faceInk]);
  return <SvgXml xml={xml} width={size} height={size} />;
});
