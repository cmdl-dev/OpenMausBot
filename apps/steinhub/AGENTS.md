# SteinHub agent notes

SteinHub is the Expo (React Native) phone app for OpenMausBot. These notes
override the root `AGENTS.md` within `apps/steinhub`; its comment rules still
apply.

- **Design source:** `designs/` (approved mockups, `tokens.md`, the navigation
  map in `README.md`), not the root `DESIGN.md`, which covers the desktop app.
  Every colour, size and type style comes from `src/theme`; a token missing
  there is added to `tokens.ts` first.
- **Wire contract:** types and helpers shared with the desktop come from
  `@openmausbot/phone-protocol/<file>.ts` (workspace package). Import from it
  rather than copying a type or a parser into the app.
- **Sample data:** screens read `src/sample/world.ts` until the real
  connection exists. Keep names and numbers in step with the sample world in
  `designs/README.md`.
- **Tests:** `src/testing/*.test.tsx` render the real `src/app` routes with
  `expo-router/testing-library`. The drawer layout is swapped for a Stack there
  because Reanimated 4.7's jest build needs a DOM.
- **Checks:** `pnpm steinhub:check` (tsc, oxlint, jest) and `npx expo-doctor`
  in this folder. `pnpm lint` at the root also lints this app.
