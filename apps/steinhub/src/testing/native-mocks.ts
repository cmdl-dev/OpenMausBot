import type { FetchLike } from "@/api/transport";

/** Module stand-ins for jest.mock factories: native modules jest can't load, and the network. */
export const secureValues = new Map<string, string>();

export const secureStore = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItem: (key: string) => secureValues.get(key) ?? null,
  getItemAsync: async (key: string) => secureValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureValues.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secureValues.delete(key);
  },
};

let uuid = 0;
export const crypto = { randomUUID: () => `uuid-${String(++uuid).padStart(20, "0")}` };

export const camera = {
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: true }, async () => ({ granted: false, canAskAgain: true })],
};

export const network: { fetch: FetchLike } = {
  fetch: async () => {
    throw new TypeError("Network request failed");
  },
};
