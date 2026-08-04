# Slate

Personal task board. Vanilla JS, Supabase backend, hosted on GitHub Pages at
[slate.builtbyleon.com](https://slate.builtbyleon.com).

## Development

```sh
npm install
npm run dev      # watch + local server on port 3001
npm run build    # build JS and CSS
```

Needs a `.env` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and (optionally)
`TURNSTILE_SITE_KEY`. See `.env.example`.

See [CLAUDE.md](CLAUDE.md) for architecture notes and
[GMAIL-INTEGRATION.md](GMAIL-INTEGRATION.md) for the mail-scanning setup.
