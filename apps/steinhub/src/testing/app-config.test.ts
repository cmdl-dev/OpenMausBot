import appJson from "../../app.json";

type PluginEntry = string | [string, Record<string, unknown>];

const pluginOptions = (appJson.expo.plugins as PluginEntry[]).flatMap((entry) => (typeof entry === "string" ? [] : [{ name: entry[0], options: entry[1] }]));

describe("app.json microphone access for dictation", () => {
  // iOS terminates an app that asks for the microphone when its Info.plist has no NSMicrophoneUsageDescription.
  // A plugin given `microphonePermission: false` deletes that key, whichever plugin sets it.
  it("no plugin removes the microphone usage string", () => {
    const removing = pluginOptions.filter(({ options }) => options.microphonePermission === false).map(({ name }) => name);
    expect(removing).toEqual([]);
  });

  it("every plugin that names the microphone uses the dictation wording", () => {
    const wordings = new Set(pluginOptions.flatMap(({ options }) => (typeof options.microphonePermission === "string" ? [options.microphonePermission] : [])));
    expect([...wordings]).toEqual(["SteinHub listens while you dictate a message."]);
  });

  it("Android keeps RECORD_AUDIO", () => {
    const blocking = pluginOptions.filter(({ options }) => options.recordAudioAndroid === false).map(({ name }) => name);
    expect(blocking).toEqual([]);
  });
});
