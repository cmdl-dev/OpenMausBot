# SteinHub design tokens

Dark only for v1. Near-black canvas, white type, grey surfaces, thin borders, no gradients. Color carries meaning (status, bot identity) and is used sparingly. Every mockup in this folder inlines these values as CSS custom properties, so the names below match the `--tokens` in the HTML.

## Color

### Canvas and surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | App canvas, chat background |
| `--bg-raised` | `#0A0A0A` | Drawer, sheets, modal background |
| `--surface-1` | `#151515` | Cards, composer, list groups |
| `--surface-2` | `#1F1F1F` | Chips, secondary buttons, input fills, pressed rows |
| `--surface-3` | `#2A2A2A` | Hover/pressed on surface-2, toggle track (off) |
| `--border` | `#242424` | Hairline borders and dividers (1px) |
| `--border-strong` | `#333333` | Focused inputs, selected chips |
| `--scrim` | `rgba(0,0,0,0.6)` | Behind drawer and sheets |

### Text

| Token | Value | Use |
|---|---|---|
| `--text` | `#FFFFFF` | Primary text, icons |
| `--text-2` | `#A1A1A1` | Secondary text, metadata |
| `--text-3` | `#6B6B6B` | Placeholders, disabled, timestamps |
| `--text-inverse` | `#000000` | Text on the white primary button |

### Accent and status

The primary action is a white pill with black text (`--text` fill, `--text-inverse` label). There is no brand hue: the one blue control is dictation's Done button (`--accent`). Status colors appear only as dots, small badges, and 1px tinted borders.

| Token | Value | Use |
|---|---|---|
| `--success` | `#3DD68C` | Online, completed run, approved |
| `--warning` | `#F5B544` | Needs attention, asleep, paused |
| `--danger` | `#FF5C5C` | Failed run, offline, destructive |
| `--info` | `#6CA8FF` | Links, running/streaming indicator |
| `--accent` | `#4A6CF7` | Dictation's Done button |
| `--viewer` | `#000000` | The full-screen image viewer, black in either theme |
| `--on-viewer` | `#FFFFFF` | The viewer's close button and messages |
| `--on-viewer-2` | `rgba(255,255,255,0.6)` | The viewer's "Pinch to zoom" hint |
| `--viewer-control` | `rgba(255,255,255,0.15)` | The viewer's close button fill |
| `--success-bg` | `rgba(61,214,140,0.12)` | Status badge fill |
| `--warning-bg` | `rgba(245,181,68,0.12)` | Status badge fill |
| `--danger-bg` | `rgba(255,92,92,0.12)` | Status badge fill |
| `--info-bg` | `rgba(108,168,255,0.12)` | Status badge fill |

### Bot identity tints

Each bot gets a muted avatar tint so you can tell bots apart in lists and the Inbox. New bots take the next tint in this order.

| Token | Background | Glyph |
|---|---|---|
| `--bot-violet` | `#262040` | `#C8B8FF` |
| `--bot-green` | `#1B3024` | `#9FE0B5` |
| `--bot-amber` | `#33291A` | `#F2C98A` |
| `--bot-blue` | `#1A2A3D` | `#9CC4FF` |
| `--bot-rose` | `#3A1F27` | `#FFB3C4` |

Sample assignment: MausBot = violet, Mobile App = green, Mac helper = amber.

## Typography

Font: `Inter`, falling back to `-apple-system, "SF Pro Text", Roboto, system-ui, sans-serif`. In the app, use the system font (SF Pro on iOS, Roboto on Android) unless the owner wants Inter bundled. Mono: `"SF Mono", ui-monospace, Menlo, monospace` for code, IDs, and cron strings.

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `--type-display` | 30 / 36 | 600 | -0.02em | Empty-chat greeting, onboarding headline |
| `--type-title` | 22 / 28 | 600 | -0.01em | Screen titles (large) |
| `--type-headline` | 17 / 22 | 600 | 0 | Top bar title, card titles |
| `--type-body` | 16 / 24 | 400 | 0 | Chat messages, primary row text |
| `--type-callout` | 15 / 20 | 400 | 0 | Composer input, buttons (500) |
| `--type-subhead` | 14 / 20 | 400 | 0 | Secondary row text, chips (500) |
| `--type-footnote` | 13 / 18 | 400 | 0 | Metadata, tool-activity rows |
| `--type-caption` | 12 / 16 | 500 | 0 | Badges, timestamps |
| `--type-overline` | 11 / 14 | 600 | 0.06em, uppercase | Section labels in drawer and settings |

## Spacing

4pt base. Screen side gutter is `--space-4` (16). Vertical rhythm between groups is `--space-6` (24).

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |

## Radius

| Token | Value | Use |
|---|---|---|
| `--r-sm` | 8px | Badges, small thumbnails, code blocks |
| `--r-md` | 12px | List rows inside groups, inputs |
| `--r-lg` | 16px | Cards, grouped lists, approval card |
| `--r-xl` | 24px | Bottom sheets (top corners), large tiles |
| `--r-pill` | 999px | Composer, chips, primary buttons, toggles |

## Sizes and elevation

| Token | Value | Use |
|---|---|---|
| `--tap` | 44px | Minimum touch target |
| `--topbar-h` | 52px | Top bar height below the status bar |
| `--composer-h` | 52px | Composer pill minimum height |
| `--avatar-sm` / `--avatar-md` / `--avatar-lg` | 28 / 40 / 72px | Rows, inbox, bot profile |
| `--stroke` | 1.75px | Icon stroke width (24px icons drawn at 20px) |
| `--shadow-sheet` | `0 -8px 32px rgba(0,0,0,0.5)` | Sheets and drawer only; everything else is flat |

## Motion (for implementation)

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | Drawer, sheets, row expansion |
| `--dur-fast` | 120ms | Press states, toggles |
| `--dur-base` | 220ms | Sheet and drawer slide |
| Streaming caret | 1s blink | Shown at the end of a streaming reply |

## Iconography

Outline icons, 20px glyph in a 24px box, 1.75px round stroke, `currentColor`. The mockups draw them as inline SVG in the Lucide style. For the app, use `lucide-react-native` or an equivalent outline set; don't mix filled and outline icons except for the active state of a toggle-like icon.

## Logo

The SteinHub mark is a hexagonal stone outline with a center hub and three spokes, drawn in `--text` on `--bg`. The wordmark is "SteinHub" in the display weight with -0.02em tracking. Both are original; nothing is taken from other assistant apps.
