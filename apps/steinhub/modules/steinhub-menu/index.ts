import { requireOptionalNativeModule } from "expo";

export interface MenuItem {
  title: string;
  /** An SF Symbol name; Android menus show titles only. */
  icon?: string;
}

interface MenuModule {
  show(x: number, y: number, items: MenuItem[]): Promise<number | null>;
}

/** Absent from Expo Go and from a build made before it: then no menu opens, and long-press selection still copies. */
const native = requireOptionalNativeModule<MenuModule>("SteinHubMenu");

/**
 * Pops the system's own small menu up at a point on screen (page coordinates of a touch).
 * Resolves with the item chosen, or null when it is dismissed or can't be shown.
 */
export async function showMenu<T extends MenuItem>(point: { x: number; y: number }, items: T[]): Promise<T | null> {
  if (!native || items.length === 0) return null;
  const index = await native.show(point.x, point.y, items.map(({ title, icon }) => ({ title, ...(icon ? { icon } : {}) })));
  return index === null ? null : (items[index] ?? null);
}
