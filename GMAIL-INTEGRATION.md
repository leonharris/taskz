# Gmail → task suggestions

Scans your sent mail for things you said you'd do and queues them as
reviewable suggestions in Slate.

**Status: code complete, not yet deployed.** Everything below under
"Still to do" is manual setup — nothing has been run against your Supabase
project or Google account yet.

---

## What's built

| Piece | Where |
|---|---|
| Database schema | `supabase/schema/gmail-integration.sql` |
| Edge Function | `supabase/functions/gmail-ingest/index.ts` |
| Apps Script relay | `integrations/gmail-relay.gs` |
| Settings + suggestions UI | `index.html`, `assets/js/src/main.js`, `assets/scss/partials/_modal.scss` |

### How it fits together

```
Gmail (your account)
  └─ gmail-relay.gs          every 30 min, searches in:sent, POSTs new messages
       └─ gmail-ingest       authenticates by token, checks the toggle,
            │                skips already-seen IDs, extracts via Claude
            └─ task_suggestions (table)
                 └─ Slate badge → review modal → you accept → task on board
```

### Why suggestions live in their own table

The board is one JSON blob rewritten from the DOM every 5 seconds
(`getBoardData()` → `saveBoardToSupabase()`). Anything written into it
server-side gets overwritten within a tick, and task IDs are positional so
they can't be referenced across saves. Suggestions therefore sit in
`task_suggestions`; accepting one creates the task **client-side** via
`createTask()` + `markDirty()` and lets the normal autosave carry it.

### Tables

- **`user_settings`** — toggle, target column, scan window, confidence floor,
  and `ingest_token`. The token is frozen by a DB trigger: you can read yours
  (to paste into the script) but not set it, so nobody can overwrite theirs
  with someone else's and hijack the ingest.
- **`gmail_processed`** — which Gmail message IDs have been looked at. Checked
  *before* the Claude call, so re-scans cost nothing.
- **`task_suggestions`** — extracted commitments awaiting review.

---

## Still to do

### 1. Create the tables

Supabase dashboard → SQL Editor → paste and run
`supabase/schema/gmail-integration.sql`.

Sanity check afterwards:

```sql
select * from public.user_settings;      -- empty until you next load the app
select * from public.task_suggestions;   -- empty
```

### 2. Set the API key

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
don't set those.

### 3. Deploy the function

```sh
supabase functions deploy gmail-ingest --no-verify-jwt
```

`--no-verify-jwt` is required. The relay authenticates with the per-user
ingest token, not a Supabase JWT; without the flag every request 401s before
reaching the function.

### 4. Turn it on in Slate

Load the app (this creates your `user_settings` row and generates the token),
then ··· → **Settings**:

- Enable **Scan sent email for commitments**
- Pick the column accepted tasks land in
- Copy the **Ingest URL** and **Ingest token**

### 5. Install the Apps Script

1. [script.google.com](https://script.google.com) → New project
2. Paste in `integrations/gmail-relay.gs`
3. Fill in `INGEST_URL` and `INGEST_TOKEN` from step 4
4. Run `setUp()` — authorise Gmail access when prompted

Because the script runs in your own account against your own mail, there's no
OAuth consent screen to get verified and no 7-day refresh-token expiry. That's
the whole reason for this approach over a Google OAuth app.

`setUp()` installs the 30-minute trigger and runs one scan immediately.
`tearDown()` removes it. `scanSentMail()` forces a scan any time.

### 6. Check the first run

- **Apps Script** → Executions — should log `Sent N message(s); M suggestion(s) created.`
- **Supabase** → `select * from task_suggestions order by created_at desc;`
- **Slate** — envelope badge in the navbar

Look at the first real batch before trusting the badge. The prompt is
deliberately biased toward returning nothing, so expect misses before false
positives. If it's too eager or too shy, the prompt is `SYSTEM_PROMPT` in
`supabase/functions/gmail-ingest/index.ts`.

---

## Knobs

| What | Where | Default |
|---|---|---|
| Model | `MODEL` in `index.ts` | `claude-opus-5` |
| Reasoning effort | `output_config.effort` in `index.ts` | `low` |
| Confidence floor | Settings modal | 0.4 |
| Look-back window | Settings modal | 2 days |
| Scan frequency | `setUp()` in `gmail-relay.gs` | 30 min |
| Max emails per run | `MAX_MESSAGES` / `MAX_BATCH` | 25 |
| Body truncation | `MAX_BODY_CHARS` | 6000 chars |

Each scan sends **one message per thread** — the most recent one you sent —
with the quoted history stripped off the bottom (`stripQuotedText()`). So a
long back-and-forth costs one short extraction per scan, not one per reply.

Switching to `claude-haiku-4-5` is a one-line change in `MODEL` and cuts cost
roughly 5×, at some loss of judgement on ambiguous phrasing.

**Cost:** the system prompt is cached, so the marginal cost is roughly the
email body plus a short JSON response. At ordinary sent-mail volume this is
single-digit dollars a month on Opus 5.

**Privacy:** this sends your sent-email bodies to Supabase and on to the
Anthropic API. Your key, your project, and the toggle gates it — but it is a
real change in where your mail goes.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Script throws on `INGEST_URL` | Placeholders not replaced (step 4) |
| HTTP 401 `unknown token` | Token mismatch, or function deployed without `--no-verify-jwt` |
| Log says "switched off in Slate" | Toggle is off. The watermark isn't advanced, so nothing is lost — mail sent while off is picked up once it's back on |
| Suggestions in the table, no badge | Realtime not enabled on `task_suggestions` — the `alter publication` at the end of the SQL file |
| Same email suggested twice | `gmail_processed` row missing — check the function's `failures` array in its response |
| Nothing at all, no errors | Watermark is ahead of your test mail. `tearDown()` clears it, then `setUp()` |

Function logs: Supabase dashboard → Edge Functions → `gmail-ingest` → Logs.
