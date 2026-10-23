-- Invites: who invited who, and the cash reward. Run once in the Supabase SQL editor.
-- Reward rules live in src/game/data.ts (REFERRAL); the server passes them in, so changing them needs no SQL change.

alter table public.players add column if not exists referral_code text;
create unique index if not exists players_referral_code_key on public.players (referral_code);

create table if not exists public.referrals (
  invitee_id   uuid primary key references public.players(id) on delete cascade, -- a player can be invited once
  inviter_id   uuid not null references public.players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  sales        int not null default 0,        -- items the invitee has sold since joining
  qualified_at timestamptz,                   -- set once the invitee has sold enough; rewards are paid then
  inviter_paid numeric not null default 0,
  invitee_paid numeric not null default 0,
  constraint no_self_invite check (inviter_id <> invitee_id)
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_id);
alter table public.referrals enable row level security; -- no policies: only the server (service role) can touch it

-- A short code per player, made on first use.
create or replace function public.get_referral_code(p_id uuid) returns text language plpgsql as $$
declare c text; i int; tries int := 0;
begin
  select referral_code into c from public.players where id = p_id;
  if c is not null then return c; end if;
  loop
    c := '';
    for i in 1..7 loop c := c || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1); end loop;
    begin
      update public.players set referral_code = c where id = p_id and referral_code is null;
      exit;
    exception when unique_violation then
      tries := tries + 1; if tries > 8 then raise; end if;
    end;
  end loop;
  return (select referral_code from public.players where id = p_id);
end $$;

-- Link an invitee to an inviter. Returns false (and changes nothing) for an unknown code, your own code,
-- someone who was already invited, or two players inviting each other.
create or replace function public.redeem_referral(p_invitee uuid, p_code text) returns boolean language plpgsql as $$
declare v_inviter uuid;
begin
  select id into v_inviter from public.players where referral_code = upper(p_code);
  if v_inviter is null or v_inviter = p_invitee then return false; end if;
  if not exists (select 1 from public.players where id = p_invitee) then return false; end if;
  if exists (select 1 from public.referrals where invitee_id = v_inviter and inviter_id = p_invitee) then return false; end if;
  insert into public.referrals (invitee_id, inviter_id) values (p_invitee, v_inviter) on conflict do nothing;
  return found;
end $$;

-- Count an invitee's sales. When they reach p_need, pay once: the inviter (up to p_max_paid friends) and the invitee.
create or replace function public.referral_progress(
  p_invitee uuid, p_sales int, p_need int, p_inviter_reward numeric, p_invitee_reward numeric, p_max_paid int
) returns void language plpgsql as $$
declare r public.referrals%rowtype; pay numeric := 0; paid_n int;
begin
  update public.referrals set sales = sales + greatest(p_sales, 0)
   where invitee_id = p_invitee and qualified_at is null
   returning * into r;
  if not found or r.sales < p_need then return; end if;

  perform pg_advisory_xact_lock(hashtext(r.inviter_id::text)); -- two friends qualifying together cannot both take the last slot
  select count(*) into paid_n from public.referrals where inviter_id = r.inviter_id and inviter_paid > 0;
  if paid_n < p_max_paid then pay := p_inviter_reward; end if;

  update public.referrals set qualified_at = now(), inviter_paid = pay, invitee_paid = p_invitee_reward
   where invitee_id = p_invitee and qualified_at is null;
  if not found then return; end if;

  if pay > 0 then update public.players set money = money + pay where id = r.inviter_id; end if;
  update public.players set money = money + p_invitee_reward where id = p_invitee;
end $$;

revoke all on function public.get_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.redeem_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.referral_progress(uuid, int, int, numeric, numeric, int) from public, anon, authenticated;
grant execute on function public.get_referral_code(uuid) to service_role;
grant execute on function public.redeem_referral(uuid, text) to service_role;
grant execute on function public.referral_progress(uuid, int, int, numeric, numeric, int) to service_role;
