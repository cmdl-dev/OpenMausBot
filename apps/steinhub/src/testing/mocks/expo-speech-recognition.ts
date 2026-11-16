/** The native recognizer can't load in jest; dictation is exercised on a device. */
export const ExpoSpeechRecognitionModule = {
  start: () => undefined,
  stop: () => undefined,
  abort: () => undefined,
  requestPermissionsAsync: async () => ({ granted: false }),
  supportsOnDeviceRecognition: () => false,
};

export function useSpeechRecognitionEvent(): void {}
