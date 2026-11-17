# Page health and recorded browser steps

What a bot's page reports (console errors, uncaught errors, failed requests)
reaches the bot in its browser tool results. Steps recorded before the bots'
browser moved to OpenMausBot's own Chrome driver stay readable with their
conversation; the driver records no new steps, and a bot's settings no longer
offer **Record browser steps**.

## The automated check

```sh
pnpm exec vitest run server/browser/tools.test.ts server/browser-page-health.test.ts \
  server/browser-evidence.test.ts server/routes/browser-evidence.test.ts
```

1. A click whose page throws, or whose request fails, reports it in that one
   result, quoted as page output (`server/browser/tools.test.ts`), one line
   per kind, capped and stripped of anything that is not page text
   (`server/browser-page-health.test.ts`).
2. `GET /api/threads/ID/evidence`, the screenshot under
   `/api/threads/ID/evidence/GENERATION/step-NNNNNN.jpg` and
   `GET /api/threads/ID/evidence.tar` answer for a conversation that has
   recorded steps, and deleting the bot deletes them
   (`server/routes/browser-evidence.test.ts`, `server/browser-evidence.test.ts`).

## By hand

1. Launch the [live browser fixture](browser-live.md). Give the printed test
   page a button that throws, or that posts to an endpoint answering 500.
2. Script a turn that opens the test page and clicks the button (the fake
   engine's scripted steps take `"server": "browser"`). The click's result ends
   with one `Page reported …` line naming the error or the failed request.
3. In Pepper's settings, Access → Browser shows no **Record browser steps**
   switch.
4. In a data folder that holds steps an older version recorded, read them back:

   ```sh
   curl -s "$URL/api/threads/$THREAD/evidence" | jq '.steps[] | {step, action, imageUrl, imageSkipped}'
   curl -s -o steps.tar "$URL/api/threads/$THREAD/evidence.tar" && tar tf steps.tar
   ```

5. Delete the conversation: `DATA_DIR/evidence/<thread>` is gone.
