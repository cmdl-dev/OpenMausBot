import { Stack } from "expo-router";
import { renderRouter, screen } from "expo-router/testing-library";

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

test("home opens on an empty chat with the top bar and composer", async () => {
  await renderRouter(
    { appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } },
    { initialUrl: "/" },
  );

  expect(screen).toHavePathname("/");
  expect(screen.getByLabelText("Open drawer")).toBeTruthy();
  expect(screen.getByLabelText("Switch bot, MausBot")).toBeTruthy();
  expect(screen.getByLabelText("Inbox, unread items")).toBeTruthy();
  expect(screen.getByPlaceholderText("Ask MausBot anything")).toBeTruthy();
  expect(screen.getByText(/, Alex$/)).toBeTruthy();
});
