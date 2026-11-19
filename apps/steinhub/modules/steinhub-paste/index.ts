import { requireOptionalNativeModule, type EventSubscription } from "expo";

export interface PastedImage {
  uri: string;
  width: number;
  height: number;
}

interface PasteModule {
  setAcceptsImages(on: boolean): void;
  addListener(event: "onPasteImages", listener: (event: { images: PastedImage[] }) => void): EventSubscription;
}

/** iOS only, and absent from a build made before it: then a pasted image does nothing, as before. */
const native = requireOptionalNativeModule<PasteModule>("SteinHubPaste");

/** Images pasted into any text field: from the field's Paste or the keyboard's clipboard suggestion. */
export function addPastedImagesListener(listener: (images: PastedImage[]) => void): EventSubscription | null {
  return native?.addListener("onPasteImages", (event: { images: PastedImage[] }) => listener(event.images)) ?? null;
}

/** While on, an image pasted into the focused text field comes to `addPastedImagesListener` instead of being dropped. */
export function acceptPastedImages(on: boolean): void {
  native?.setAcceptsImages(on);
}
