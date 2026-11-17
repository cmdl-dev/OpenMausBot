import { Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { elapsedLabel, levelFromVolume } from "@/components/dictation-bar";
import { speech } from "@/testing/mocks/expo-speech-recognition";

function DrawerWithoutAnimation() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

async function dictateOnHome() {
  speech.reset();
  speech.granted = true;
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/" });
  await fireEvent.changeText(screen.getByLabelText("Message"), "Draft");
  await fireEvent.press(screen.getByLabelText("Dictate"));
}

test("dictation swaps the field for a bar that shows the words as they're heard, and Done keeps them", async () => {
  await dictateOnHome();
  expect(await screen.findByText("Listening…")).toBeTruthy();
  expect(screen.getByText("0:00")).toBeTruthy();
  expect(screen.queryByLabelText("Message")).toBeNull();
  expect(speech.calls).toEqual(["start"]);

  await act(async () => {
    speech.emit("volumechange", { value: 6 });
    speech.emit("result", { results: [{ transcript: "book the venue" }] });
  });
  expect(screen.getByText("book the venue")).toBeTruthy();

  await fireEvent.press(screen.getByLabelText("Done dictating"));
  expect(speech.calls).toEqual(["start", "stop"]);
  await act(async () => {
    speech.emit("result", { results: [{ transcript: "book the venue for Friday" }] });
    speech.emit("end");
  });
  expect(screen.queryByLabelText("Done dictating")).toBeNull();
  expect(screen.getByLabelText("Message").props.value).toBe("Draft book the venue for Friday");
});

test("Cancel stops listening and leaves the field as it was", async () => {
  await dictateOnHome();
  await act(async () => speech.emit("result", { results: [{ transcript: "never mind" }] }));
  await fireEvent.press(screen.getByLabelText("Cancel dictation"));
  expect(speech.calls).toEqual(["start", "abort"]);
  expect(screen.getByLabelText("Message").props.value).toBe("Draft");
});

test("without microphone access the field stays and says what to turn on", async () => {
  speech.reset();
  await renderRouter({ appDir: "src/app", overrides: { "(drawer)/_layout": DrawerWithoutAnimation } }, { initialUrl: "/" });
  await fireEvent.press(screen.getByLabelText("Dictate"));
  expect(await screen.findByText(/Dictation needs microphone and speech recognition access/)).toBeTruthy();
  expect(speech.calls).toEqual([]);
});

test("volume maps to a bar level and seconds to a clock", () => {
  expect(levelFromVolume(-2)).toBe(0);
  expect(levelFromVolume(0)).toBe(0);
  expect(levelFromVolume(10)).toBe(1);
  expect(levelFromVolume(14)).toBe(1);
  expect(elapsedLabel(0)).toBe("0:00");
  expect(elapsedLabel(71)).toBe("1:11");
});
