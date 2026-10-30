-- =====================================================================
--  دعوة عمر وحبيبة — إعداد قاعدة البيانات (Supabase)
--  الصق هذا الملف كاملًا في: SQL Editor ← New query ← Run
--  آمن للتشغيل أكثر من مرة.
-- =====================================================================

-- بريد صاحب الدعوة الوحيد المسموح له بالقراءة
create or replace function public.is_invite_owner()
returns boolean
language sql stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') = 'omar.mostafa599@gmail.com'
     and coalesce((auth.jwt() ->> 'role'), '') = 'authenticated';
$$;

-- ---------- الزيارات وفتح الظرف (عداد مجهول) ----------
create table if not exists public.invite_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  version     text not null check (version in ('front', 'back')),
  kind        text not null check (kind in ('visit', 'open')),
  device      text check (device is null or device ~ '^[a-z0-9]{8,40}$'),
  is_test     boolean not null default false
);

-- ---------- تأكيد الحضور ----------
create table if not exists public.invite_rsvps (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  version     text not null check (version in ('front', 'back')),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  attending   boolean not null,
  device      text check (device is null or device ~ '^[a-z0-9]{8,40}$'),
  is_test     boolean not null default false
);

-- ---------- المباركات (نص و/أو صوت) ----------
create table if not exists public.invite_wishes (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  version       text not null check (version in ('front', 'back')),
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  message       text check (message is null or char_length(message) <= 1500),
  audio_path    text check (audio_path is null or audio_path ~ '^(front|back)/[a-z0-9-]{8,60}\.(m4a|webm|ogg)$'),
  audio_seconds integer check (audio_seconds is null or audio_seconds between 1 and 125),
  audio_bytes   integer check (audio_bytes is null or audio_bytes between 1 and 6291456),
  video_path    text check (video_path is null or video_path ~ '^(front|back)/[a-z0-9-]{8,60}\.(mp4|webm)$'),
  video_seconds integer check (video_seconds is null or video_seconds between 1 and 65),
  video_bytes   integer check (video_bytes is null or video_bytes between 1 and 20971520),
  device        text check (device is null or device ~ '^[a-z0-9]{8,40}$'),
  is_test       boolean not null default false,
  constraint wish_has_content check (
    (message is not null and char_length(btrim(message)) > 0) or audio_path is not null or video_path is not null
  )
);

create index if not exists invite_events_kind_idx on public.invite_events (kind, version);
create index if not exists invite_rsvps_created_idx on public.invite_rsvps (created_at desc);
create index if not exists invite_wishes_created_idx on public.invite_wishes (created_at desc);

-- ---------- الصلاحيات: الضيف يضيف فقط، والقراءة لصاحب الدعوة فقط ----------
alter table public.invite_events enable row level security;
alter table public.invite_rsvps  enable row level security;
alter table public.invite_wishes enable row level security;

revoke all on public.invite_events, public.invite_rsvps, public.invite_wishes from anon, authenticated;
grant insert on public.invite_events, public.invite_rsvps, public.invite_wishes to anon, authenticated;
grant select on public.invite_events, public.invite_rsvps, public.invite_wishes to authenticated;

drop policy if exists "guests add events"  on public.invite_events;
drop policy if exists "guests add rsvps"   on public.invite_rsvps;
drop policy if exists "guests add wishes"  on public.invite_wishes;
drop policy if exists "owner reads events" on public.invite_events;
drop policy if exists "owner reads rsvps"  on public.invite_rsvps;
drop policy if exists "owner reads wishes" on public.invite_wishes;

create policy "guests add events"  on public.invite_events for insert to anon, authenticated with check (true);
create policy "guests add rsvps"   on public.invite_rsvps  for insert to anon, authenticated with check (true);
create policy "guests add wishes"  on public.invite_wishes for insert to anon, authenticated with check (true);
create policy "owner reads events" on public.invite_events for select to authenticated using (public.is_invite_owner());
create policy "owner reads rsvps"  on public.invite_rsvps  for select to authenticated using (public.is_invite_owner());
create policy "owner reads wishes" on public.invite_wishes for select to authenticated using (public.is_invite_owner());

-- ---------- مخزن التسجيلات الصوتية (خاص) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invite-voices', 'invite-voices', false, 6291456,
        array['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- مخزن فيديوهات التهنئة (خاص، حتى 20 ميجا للملف) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invite-videos', 'invite-videos', false, 20971520, array['video/mp4', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "guests upload voices" on storage.objects;
drop policy if exists "owner reads voices"   on storage.objects;

create policy "guests upload voices" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id in ('invite-voices', 'invite-videos') and (storage.foldername(name))[1] in ('front', 'back'));

create policy "owner reads voices" on storage.objects
  for select to authenticated
  using (bucket_id in ('invite-voices', 'invite-videos') and public.is_invite_owner());

-- تحقّق سريع بعد التشغيل:
select 'تم الإعداد بنجاح' as result,
       (select count(*) from storage.buckets where id in ('invite-voices', 'invite-videos')) as buckets;
