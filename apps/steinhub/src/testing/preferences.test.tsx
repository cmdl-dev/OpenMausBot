import { Stack } from "expo-router";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { loadPreferences, resetPreferences } from "@/state/preferences";
import { secureValues } from "@/testing/native-mocks";

jest.mock("expo-secure-store", () => jest.requireActual("@/testing/native-mocks").secureStore);
jest.mock("@/state/restart", () => ({ restartApp: jest.fn(async () => {}) }));
jest.mock("@/state/app-lock", () => ({ confirmOwner: jest.fn(async () => true), useLockMethod: () => "Face ID" }));

const { restartApp } = jest.requireMock<{ restartApp: jest.Mock }>("@/state/restart");
const { confirmOwner } = jest.requireMock<{ confirmOwner: jest.Mock }>("@/state/app-lock");

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function render(initialUrl: string) {
  return renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
}

function saved() {
  return JSON.parse(secureValues.get("steinhub.preferences") ?? "{}");
}

beforeEach(() => {
  secureValues.clear();
  resetPreferences();
  restartApp.mockClear();
  confirmOwner.mockClear();
  confirmOwner.mockResolvedValue(true);
});

test("the default bot is the one a new chat starts with", async () => {
  await render("/settings");
  await fireEvent.press(await screen.findByText("Default bot"));
  expect(screen).toHavePathname("/sheets/default-bot");
  await fireEvent.press(screen.getByLabelText("Mobile App"));
  await waitFor(() => expect(screen).toHavePathname("/settings"));
  expect(saved().defaultBot).toBe("mobile-app");
  expect(screen.getByText("Mobile App")).toBeTruthy();
});

test("a new chat opens on the saved default bot", async () => {
  secureValues.set("steinhub.preferences", JSON.stringify({ defaultBot: "mobile-app" }));
  await loadPreferences();
  await render("/");
  expect(await screen.findByLabelText("Switch bot, Mobile App")).toBeTruthy();
});

test("a new theme is saved and the app restarts to draw it; the current one does nothing", async () => {
  await render("/sheets/theme");
  await fireEvent.press(screen.getByLabelText("System"));
  expect(restartApp).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Light"));
  await waitFor(() => expect(restartApp).toHaveBeenCalledTimes(1));
  expect(saved().theme).toBe("light");
});

test("a new text size is saved and the app restarts to draw it", async () => {
  await render("/sheets/text-size");
  await fireEvent.press(screen.getByLabelText("Large"));
  await waitFor(() => expect(restartApp).toHaveBeenCalledTimes(1));
  expect(saved().textSize).toBe("large");
});

test("the lock turns on and off only after Face ID or the passcode confirms it", async () => {
  await render("/settings");
  const toggle = await screen.findByLabelText("App lock");
  expect(screen.getByText("Face ID lock")).toBeTruthy();

  confirmOwner.mockResolvedValueOnce(false);
  await fireEvent(toggle, "valueChange", true);
  await waitFor(() => expect(confirmOwner).toHaveBeenCalledTimes(1));
  expect(saved().lock).toBeUndefined();

  await fireEvent(toggle, "valueChange", true);
  await waitFor(() => expect(saved().lock).toBe(true));
  expect(screen.getByLabelText("App lock").props.value).toBe(true);

  await fireEvent(screen.getByLabelText("App lock"), "valueChange", false);
  await waitFor(() => expect(saved().lock).toBe(false));
});
