import { blankPage, browserReducer, BROWSER_START, NO_ZOOM, pagePoint, zoomAt } from "@/state/browser-view";

const DRAWN = { width: 400, height: 700 };
const PAGE = { width: 1280, height: 2240 };

test("a touch maps to the page point under it", () => {
  expect(pagePoint({ x: 0, y: 0 }, DRAWN, PAGE, NO_ZOOM)).toEqual({ x: 0, y: 0 });
  expect(pagePoint({ x: 200, y: 350 }, DRAWN, PAGE, NO_ZOOM)).toEqual({ x: 640, y: 1120 });
  expect(pagePoint({ x: 400, y: 700 }, DRAWN, PAGE, NO_ZOOM)).toEqual({ x: 1279, y: 2239 });
});

test("zoomed in, the centre stays put and the edges move out", () => {
  const zoom = { scale: 2, x: 0, y: 0 };
  expect(pagePoint({ x: 200, y: 350 }, DRAWN, PAGE, zoom)).toEqual({ x: 640, y: 1120 });
  expect(pagePoint({ x: 0, y: 0 }, DRAWN, PAGE, zoom)).toEqual({ x: 320, y: 560 });
});

test("a zoomed page moved right shows what was to its left", () => {
  expect(pagePoint({ x: 200, y: 350 }, DRAWN, PAGE, { scale: 2, x: 100, y: 0 })).toEqual({ x: 480, y: 1120 });
});

test("frames, control and errors update the view", () => {
  let state = browserReducer(BROWSER_START, { type: "ready", viewerId: "v1" });
  expect(state.phase).toBe("showing");
  state = browserReducer(state, {
    type: "frame",
    seq: 1,
    data: "AAAA",
    format: "jpeg",
    metadata: { deviceWidth: 1280, deviceHeight: 800, offsetTop: 0, pageScaleFactor: 1, scrollOffsetX: 0, scrollOffsetY: 0, timestamp: 0 },
  });
  expect(state.frame).toEqual({ uri: "data:image/jpeg;base64,AAAA", page: { width: 1280, height: 800 } });
  state = browserReducer(state, { type: "control", held: true, owned: true, controlling: true });
  expect(state.control?.controlling).toBe(true);
  state = browserReducer(state, { type: "error", retryable: false, asleep: true, message: "Asleep." });
  expect(state).toMatchObject({ phase: "ended", asleep: true, control: null, problem: "Asleep." });
});

test("a blank tab is one a sign-in fills", () => {
  expect(blankPage("")).toBe(true);
  expect(blankPage("about:blank")).toBe(true);
  expect(blankPage("https://example.com/")).toBe(false);
});

test("pinching keeps the page under the fingers in place", () => {
  const focal = { x: -100, y: -200 };
  const zoomed = zoomAt(NO_ZOOM, 2, focal);
  const under = (zoom: typeof NO_ZOOM) => pagePoint({ x: 200 + focal.x, y: 350 + focal.y }, DRAWN, PAGE, zoom);
  expect(under(zoomed)).toEqual(under(NO_ZOOM));
  expect(under(zoomAt(zoomed, 3, focal))).toEqual(under(NO_ZOOM));
});
