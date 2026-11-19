import { mascotSvg } from "@/components/mascot";
import { botLook } from "@/state/views";

test("a mascot is the body in the bot's gradient with two eyes and a mouth in its face ink", () => {
  const svg = mascotSvg({ body: "blob", color: "purple", faceInk: "#000000" });
  expect(svg).toContain('stop-color="#8057C8"');
  expect(svg).toContain('fill="url(#g)"');
  expect(svg.match(/<path fill="#000000"/g)).toHaveLength(2);
  expect(svg).toContain('stroke="#000000"');
  expect(svg).not.toContain("{{GRADIENT}}");
});

test("a bot's look follows its saved body, colour, face and picture", () => {
  expect(botLook({ color: "blue", mascotBody: "star", mascotFaceColor: "black", avatarUrl: null })).toEqual({
    body: "star",
    color: "blue",
    faceInk: "#000000",
    picture: undefined,
  });
  expect(botLook({ color: "blue", mascotBody: "pumpkin", avatarUrl: "/api/attachments/abc-1.png", avatarCrop: "rounded" })).toEqual({
    body: "cursor",
    color: "blue",
    faceInk: undefined,
    picture: { path: "/api/attachments/abc-1.png", crop: "rounded" },
  });
});
