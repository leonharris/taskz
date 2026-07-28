-- Gmail → task suggestions
--
-- Run this once in the Supabase SQL editor. It creates three tables:
--
--   user_settings     per-user config, including the ingest token the Apps
--                     Script presents and the on/off toggle
--   gmail_processed   which Gmail message IDs have already been looked at.
--                     This is the dedupe guard — checked before the Claude
--                     call, so a re-scan costs nothing.
--   task_suggestions  extracted commitments awaiting review
--
-- Suggestions deliberately live outside boards.data. The board is a single
-- JSON blob rewritten from the DOM every 5 seconds, so anything the server
-- writes into it is overwritten by the next autosave from an open tab.

-- Settings -------------------------------------------------------------

create table if not exists public.user_settings (
	user_id           uuid primary key references auth.users(id) on delete cascade,
	gmail_enabled     boolean     not null default false,
	target_column     text,                       -- column *name*; ids are regenerated on load
	scan_window_days  integer     not null default 2,
	min_confidence    numeric     not null default 0.4,
	ingest_token      text        not null unique default encode(gen_random_bytes(24), 'hex'),
	created_at        timestamptz not null default now(),
	updated_at        timestamptz not null default now(),

	constraint scan_window_days_sane check (scan_window_days between 1 and 30),
	constraint min_confidence_sane   check (min_confidence between 0 and 1)
);

alter table public.user_settings enable row level security;

create policy "own settings: select" on public.user_settings
	for select using (auth.uid() = user_id);
create policy "own settings: insert" on public.user_settings
	for insert with check (auth.uid() = user_id);
create policy "own settings: update" on public.user_settings
	for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The ingest token is a bearer credential. Users may read their own (they
-- paste it into the Apps Script) but must never be able to set it, or they
-- could collide with another user's token and hijack their ingest.
create or replace function public.freeze_ingest_token()
returns trigger language plpgsql as $$
begin
	new.ingest_token := old.ingest_token;
	new.user_id      := old.user_id;
	new.updated_at   := now();
	return new;
end;
$$;

drop trigger if exists freeze_ingest_token on public.user_settings;
create trigger freeze_ingest_token
	before update on public.user_settings
	for each row execute function public.freeze_ingest_token();

-- Processed-message guard ----------------------------------------------

create table if not exists public.gmail_processed (
	user_id           uuid        not null references auth.users(id) on delete cascade,
	gmail_message_id  text        not null,
	processed_at      timestamptz not null default now(),
	primary key (user_id, gmail_message_id)
);

alter table public.gmail_processed enable row level security;

create policy "own processed: select" on public.gmail_processed
	for select using (auth.uid() = user_id);

-- Suggestions ----------------------------------------------------------

create table if not exists public.task_suggestions (
	id                uuid primary key default gen_random_uuid(),
	user_id           uuid        not null references auth.users(id) on delete cascade,
	gmail_message_id  text        not null,

	title             text        not null,
	description       text,
	recipient         text,
	due_date          date,
	confidence        numeric,

	email_subject     text,
	email_snippet     text,
	email_date        timestamptz,
	email_link        text,

	status            text        not null default 'pending',
	created_at        timestamptz not null default now(),

	constraint status_valid     check (status in ('pending', 'accepted', 'dismissed')),
	constraint confidence_sane  check (confidence is null or confidence between 0 and 1)
);

alter table public.task_suggestions enable row level security;

create policy "own suggestions: select" on public.task_suggestions
	for select using (auth.uid() = user_id);
create policy "own suggestions: update" on public.task_suggestions
	for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own suggestions: delete" on public.task_suggestions
	for delete using (auth.uid() = user_id);
-- No insert policy: only the Edge Function (service role) creates suggestions.

create index if not exists task_suggestions_pending_idx
	on public.task_suggestions (user_id, created_at desc)
	where status = 'pending';

-- Realtime so the browser sees new suggestions without polling. The client
-- already subscribes to postgres_changes for the boards table.
alter publication supabase_realtime add table public.task_suggestions;
