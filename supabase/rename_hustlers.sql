-- One-off: give everyone still called "Hustler" a real generated name, and stop the database defaulting to it.
alter table public.players alter column name set default '';

update public.players p
   set name = 'Player' || lpad((1000 + x.n)::text, 4, '0')
  from (select id, row_number() over (order by created_at) as n from public.players where lower(name) = 'hustler') x
 where p.id = x.id;
