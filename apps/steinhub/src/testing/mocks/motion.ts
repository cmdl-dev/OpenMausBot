// Reanimated 4.7's jest build needs a DOM, and gesture-handler's detector needs Reanimated; tests only need the end
// state, so values jump straight to their target and a drag never starts.
export { default as Animated, Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "@/testing/mocks/reanimated";
export { scheduleOnRN } from "@/testing/mocks/worklets";

import type { ReactNode } from "react";

type Chain = { [method: string]: (...args: unknown[]) => Chain };
function chain(): Chain {
  return new Proxy({} as Chain, { get: (_target, _key, receiver) => () => receiver });
}

export const Gesture = { Pan: chain };

export function GestureDetector({ children }: { gesture: unknown; children: ReactNode }) {
  return children;
}
