# SteinHub design mockups

Basic mockups for every page of SteinHub, the iOS/Android companion app for OpenMausBot. There is no app code yet. These pages are for the owner to review before implementation starts.

Open [index.html](index.html) in a browser to see every page side by side. Each page is a self-contained static HTML file with 3–4 phone states in a 390 × 844 frame. Everything is dark-theme only, and all names, messages and numbers are **sample data**.

- Tokens (color, type, spacing, radius, icons, logo): [tokens.md](tokens.md)
- Visual direction: near-black canvas, white text, grey surfaces (`#151515` / `#1F1F1F`), 1px borders, pill composer and buttons, slide-out left drawer. The SteinHub mark (hexagonal stone with a hub and three spokes) and wordmark are original.

## Pages

| # | File | States shown |
|---|---|---|
| 1 | [onboarding.html](onboarding.html) | Welcome · Scan QR code · Confirm pairing (6-digit code) · Sign in |
| 2 | [home.html](home.html) | Empty new chat with greeting and suggestion chips · Bot picker sheet · Typing with attachments · Attach menu |
| 3 | [chat.html](chat.html) | Streaming reply with folded tool activity · Tool activity expanded + file and image attachments · Inline approval card (pending and resolved) · Message actions |
| 4 | [drawer.html](drawer.html) | Drawer open · History search · Thread actions (long-press) · Filtered by bot |
| 5 | [bot-profile.html](bot-profile.html) | Profile · Memory · Skills · Model picker |
| 6 | [inbox.html](inbox.html) | Inbox with "Needs you" cards · Secret request sheet · Sign-in request · Bot message (Morning brief) |
| 7 | [automations.html](automations.html) | List with filters · Create automation sheet · Empty state with templates |
| 8 | [automation-detail.html](automation-detail.html) | Scheduled automation + run history · Run detail · Paused after failures · App-event trigger |
| 9 | [computers.html](computers.html) | Computers list · Desktop host detail · Detail scrolled (bots, actions) · Asleep laptop |
| 10 | [settings.html](settings.html) | Settings · Notifications · Pairing · Appearance |

39 phone states in total.

## Navigation map

There is no tab bar. The chat screen is home, and everything else hangs off the left drawer.

```
Onboarding ──paired / signed in──▶ Home (empty chat)
                                     │
   ┌──────────── menu ───────────────┼──────── bot name ───────▶ Bot picker sheet ──▶ Manage bots ─▶ Bot profile
   ▼                                 │
 Drawer                              ├──────── send ───────────▶ Chat thread ──thread header──▶ Bot profile
   ├─ Search chats                   │                              └─ inline approval ⇄ Inbox item
   ├─ Inbox ◀──── bell (Home) ───────┘
   │    └─ Secret request · Sign-in request · Bot message ─▶ Reply in thread
   ├─ Automations ─▶ Automation detail ─▶ Run detail ─▶ Open in thread
   ├─ Computers ─▶ Computer detail
   ├─ Bots: tap = filter Recent · long-press = Bot profile
   ├─ Recent threads ─▶ Chat thread
   └─ Footer (Alex Rivera) ⚙ ─▶ Settings ─▶ Notifications · Pairing · Appearance
```

Top bar on chat screens: menu (left) · current bot + chevron (center) · new chat (right). On the empty Home screen the right button is the Inbox bell instead. Secondary screens use a back chevron with a centered or large title. Push notifications deep-link to the Inbox item or the thread.

## Sample world

Used consistently across all pages. Everything here is made up.

- User: Alex Rivera, alex@example.com. Desktop host: Alex's Mac Studio running OpenMausBot 2.4.1.
- Bots: **MausBot** (Chief of Staff, violet), **Mobile App** (builds the SteinHub iOS app, green), **Mac helper** (runs tasks on the Mac, amber). Default model label: Claude Opus 5.5.
- Computers: Alex's Mac Studio (online, desktop host), MacBook Pro (asleep), vps-fra-1 (Ubuntu VPS, online).
- Automations: Morning brief, Inbox triage, TestFlight watcher (app event), Weekly backup (paused after failures), Price check: Mac mini.
- Main thread: "Landlord lease renewal". Jordan Lee offers $2,400 → $2,520 and MausBot drafts a counter at $2,450 for 2 years, which waits for approval.

## Open questions for the owner

Designers had to guess on these. Each one changes a screen.

**Pairing and accounts**
1. Is there an account at all? The sign-in screen assumes an OpenMausBot account used to reach the desktop through a relay when away from home. If pairing by QR alone is enough, sign-in can go.
2. Does pairing need confirmation on both devices (Pair on the phone and Allow on the desktop), or only on the phone? The mockup shows both.
3. Should signing out also unpair the phone and delete local data?
4. Can the phone pair with more than one desktop host? Settings shows "Pair another computer", but the rest of the app assumes one host.

**Chat and bots**

5. Switching bots from the top bar while inside a thread: start a new thread with the new bot (assumed), or hand the current thread over?
6. In the drawer, tapping a bot filters Recent to that bot, and long-press opens its profile. Is that right, or should tapping a bot start a new chat with it?
7. "From computer" in the attach menu: does it reference files on the host in place (assumed) or upload a copy?
8. How much of a bot's setup is editable on the phone (model, skills, instructions, memory), and how much is read-only and changed on the desktop?

**Approvals, secrets, inbox**

9. Do approvals expire? If so, what happens to the bot's task when one does?
10. Approvals show up both inline in the thread and in Inbox. Should handling one in either place clear both (assumed)?
11. "Save to vault" secrets: usable by only the bot that asked, or by all bots?
12. Sign-in requests use a one-time code entered on the service's website from the phone, and the session lands on the desktop host. Is that acceptable, or should the sign-in open in a browser on the computer?
13. Can a muted bot still send approvals and secret requests? Assumed yes.

**Automations and computers**

14. Can people create automations on mobile, or only pause, run and edit ones made on the desktop?
15. Auto-pause rule: the mockup pauses after 2 failed runs in a row and retries an asleep computer for 10 minutes. Are those the real rules?
16. For app-event automations, "Run now" becomes "Test with last event". Is that the right replacement?
17. Is Wake on LAN sent through the desktop host? It only works on the same network as the sleeping machine.

**Appearance**

18. Is light theme in scope for v1? If not, should the "System" theme option ship at all?
19. Should the app bundle Inter, or use the system fonts (SF Pro / Roboto)? The tokens allow either.
20. Should the app use the new SteinHub mark? The repo's current `assets/icon.svg` is still the placeholder orange "S" from project creation.
