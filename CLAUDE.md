# Slate

Vanilla JS task board app with Supabase backend. No framework — single HTML page with show/hide views.

## Commands

- `npm run dev` — watch + local server on port 3001
- `npm run build` — build JS and CSS
- `npm run build:js` — esbuild: `assets/js/src/main.js` → `assets/js/main.min.js`
- `npm run build:css` — sass: `assets/scss/main.scss` → `assets/css/main.css`

## Project Structure

- `index.html` — all HTML (auth views, app board, modals)
- `assets/js/src/main.js` — all application logic (auth, board CRUD, drag-and-drop, Supabase sync)
- `assets/scss/main.scss` — all styles
- `build.js` — esbuild config, injects `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env`
- `.env` — environment variables (not committed)
- `supabase/schema/*.sql` — table definitions, run by hand in the SQL editor (no migration tooling)
- `supabase/functions/` — Deno Edge Functions
- `integrations/` — code that runs outside this app (e.g. the Gmail Apps Script)

## Architecture

- **Auth:** Supabase Auth (email/password). Sign-up, sign-in, password reset, sign-out.
- **Bot protection:** Cloudflare Turnstile on the sign-in form, verified by
  Supabase server-side (Auth → Attack Protection). Needs `TURNSTILE_SITE_KEY` in
  `.env`; with no key the code is inert and sign-in works unprotected. Client-only
  measures are pointless here — the anon key is public, so anything not enforced
  by Supabase can be bypassed by posting to the auth endpoint directly.
- **Data:** Supabase Postgres. `boards` table with JSON column. Auto-saves every 5 seconds.
- **Script loading:** `<script defer>` — do NOT use `async` or wrap listeners in `DOMContentLoaded`.
- **Sign-out:** UI clears immediately; `supabase.auth.signOut()` fires in background (it hangs sometimes).
- **Password recovery:** Detected via URL hash (`type=recovery`) at page load. `isPasswordRecovery` flag prevents `checkAuth()` and `onAuthStateChange` from showing the app view during recovery.

### The board blob is client-owned

`getBoardData()` scrapes the DOM and `saveBoardToSupabase()` upserts the whole
`boards.data` JSON every 5 seconds. **Nothing server-side may write into it** —
an open tab overwrites the change within one autosave tick. Task IDs are
positional and regenerated on every save, so they can't be referenced either.

Server-produced data belongs in its own table, with the client reading from it
and creating tasks through `createTask()` + `markDirty()`. The Gmail
integration is the worked example of this pattern.

### Gmail → task suggestions

Sent mail is scanned for commitments the user made, which surface as reviewable
suggestions rather than tasks written directly to the board.

- `integrations/gmail-relay.gs` — Apps Script in the user's own Google account,
  on a 30-minute trigger. Chosen over a Google OAuth app so there is no
  restricted-scope consent screen to verify and no 7-day refresh-token expiry.
- `supabase/functions/gmail-ingest/` — authenticates the relay by
  `user_settings.ingest_token`, re-checks the `gmail_enabled` toggle
  server-side, skips message IDs already in `gmail_processed` (the dedupe guard,
  before the API call), then extracts commitments with the Claude API using
  structured outputs.
- Accepting a suggestion creates the task client-side, per the rule above.

## Conventions

- No framework, no components — plain DOM manipulation
- CSS uses BEM-ish naming (`.form-field--password`, `.btn-toggle-password`)
- Event delegation for dynamically shown elements (e.g., sign-out button)
- Tabs for HTML indentation, 2 spaces for JS/SCSS
