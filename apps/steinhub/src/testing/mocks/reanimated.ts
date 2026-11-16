// Reanimated 4.7's jest build needs a DOM. Tests only need the end state: values jump straight to their target.
import { createElement, useRef, type ComponentProps } from "react";
import type { View as NativeView } from "react-native";

// Required on first render, not at import: react-native's own setup loads gesture-handler, which loads this mock.
function View(props: ComponentProps<typeof NativeView>) {
  const { View: Host } = jest.requireActual<typeof import("react-native")>("react-native");
  return createElement(Host, props);
}

type Done = ((finished: boolean) => void) | undefined;

export function createAnimatedComponent<T>(component: T): T {
  return component;
}

const Animated = { View, createAnimatedComponent };
export default Animated;

export const Easing = {
  bezier: () => (t: number) => t,
  out: (curve: (t: number) => number) => curve,
  quad: (t: number) => t,
};

export function useSharedValue<T>(initial: T): { value: T } {
  return useRef({ value: initial }).current;
}

export function useAnimatedStyle<T>(style: () => T): T {
  return style();
}

export function withTiming<T>(target: T, _config?: unknown, done?: Done): T {
  done?.(true);
  return target;
}

export function withSpring<T>(target: T, _config?: unknown, done?: Done): T {
  done?.(true);
  return target;
}

export function interpolate(value: number, input: number[], output: number[]): number {
  const [from, to] = input;
  const progress = to === from ? 0 : Math.min(1, Math.max(0, (value - from) / (to - from)));
  return output[0] + (output[1] - output[0]) * progress;
}
