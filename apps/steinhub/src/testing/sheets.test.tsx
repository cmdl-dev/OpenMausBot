import { Stack } from "expo-router";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function render(initialUrl: string) {
  return renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl });
}

test("the bot picker opens from the top bar and a pick starts a chat with that bot", async () => {
  await render("/");
  await fireEvent.press(screen.getByLabelText("Switch bot, MausBot"));
  expect(screen).toHavePathname("/sheets/bot-picker");
  expect(await screen.findByText("Chat with")).toBeTruthy();

  await fireEvent.press(screen.getByText("Mobile App"));
  expect(screen).toHavePathname("/");
  expect(await screen.findByLabelText("Switch bot, Mobile App")).toBeTruthy();
});

test("Manage bots in the picker opens the chosen bot's profile", async () => {
  await render("/sheets/bot-picker?selected=mac-helper");
  await fireEvent.press(screen.getByText("Manage bots"));
  expect(screen).toHavePathname("/bot/mac-helper");
});

test("New folder in the bot menu swaps the menu for the folder sheet", async () => {
  await render("/sheets/bot-menu?bot=mobile-app");
  expect(screen.getByLabelText("Mobile App menu")).toBeTruthy();
  await fireEvent.press(screen.getByText("New folder"));
  expect(screen).toHavePathname("/sheets/new-folder");
  expect(await screen.findByLabelText("Folder name")).toBeTruthy();
  expect(screen.getByText("For Mobile App's threads.")).toBeTruthy();
});

test("Edit profile in the bot menu opens the bot's profile", async () => {
  await render("/sheets/bot-menu?bot=mobile-app");
  await fireEvent.press(screen.getByText("Edit profile"));
  expect(screen).toHavePathname("/bot/mobile-app");
});
