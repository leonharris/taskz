# Taskz

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

## Architecture

- **Auth:** Supabase Auth (email/password). Sign-up, sign-in, password reset, sign-out.
- **Data:** Supabase Postgres. `boards` table with JSON column. Auto-saves every 5 seconds.
- **Script loading:** `<script defer>` — do NOT use `async` or wrap listeners in `DOMContentLoaded`.
- **Sign-out:** UI clears immediately; `supabase.auth.signOut()` fires in background (it hangs sometimes).
- **Password recovery:** Detected via URL hash (`type=recovery`) at page load. `isPasswordRecovery` flag prevents `checkAuth()` and `onAuthStateChange` from showing the app view during recovery.

## Conventions

- No framework, no components — plain DOM manipulation
- CSS uses BEM-ish naming (`.form-field--password`, `.btn-toggle-password`)
- Event delegation for dynamically shown elements (e.g., sign-out button)
- Tabs for HTML indentation, 2 spaces for JS/SCSS
