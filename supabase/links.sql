-- Shared links list for the Sherba Tribunal "Links" tab.
-- Run once: Supabase dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run.
-- Who can do what: anyone who has joined the group (has a row in public.members)
-- can read and add links. People can delete only the links they added.

create table if not exists public.links (
  id          uuid primary key default gen_random_uuid(),
  url         text not null check (url ~* '^https?://' and length(url) <= 2000),
  title       text check (length(title) <= 80),
  note        text check (length(note) <= 200),
  added_by    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.links enable row level security;

drop policy if exists "members read links"   on public.links;
drop policy if exists "members add links"    on public.links;
drop policy if exists "delete own links"     on public.links;

create policy "members read links" on public.links
  for select to authenticated
  using (exists (select 1 from public.members m where m.user_id = auth.uid()));

create policy "members add links" on public.links
  for insert to authenticated
  with check (added_by = auth.uid()
              and exists (select 1 from public.members m where m.user_id = auth.uid()));

create policy "delete own links" on public.links
  for delete to authenticated
  using (added_by = auth.uid());

grant select, insert, delete on public.links to authenticated;
