-- Caisse « Le Temps d'un Cookie » : base de synchronisation (Supabase).
-- À coller UNE fois dans Supabase > SQL Editor > Run. Peut être rejoué sans risque.
--
-- Une seule table : un enregistrement = une vente, une dépense, une commande, un produit ou un réglage
-- (mêmes enregistrements que la base locale de l'appli, voir db.js).
--   store      : type d'enregistrement (sales, expenses, orders, products, settings)
--   id         : identifiant, unique dans son type
--   data       : contenu (null pour une suppression : on ne garde que l'identifiant)
--   u          : date de dernière modification, donnée par le téléphone (ms)
--   d          : date de suppression (ms) ou null
--   updated_at : date d'arrivée sur le serveur ; sert aux téléphones à ne lire que les nouveautés

create table if not exists public.records (
  store      text        not null,
  id         text        not null,
  data       jsonb,
  u          bigint      not null,
  d          bigint,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (store, id)
);

create index if not exists records_updated_at_idx on public.records (updated_at);

-- Sécurité : seul l'utilisateur connecté (le compte unique) lit et écrit. Aucun accès anonyme.
alter table public.records enable row level security;
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

drop policy if exists "compte unique" on public.records;
create policy "compte unique" on public.records
  for all to authenticated using (true) with check (true);

-- Une modification plus ancienne que celle déjà enregistrée est ignorée (la plus récente gagne),
-- et chaque écriture reçoit la date du serveur.
create or replace function public.records_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.u < old.u then
    return null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
  for each row execute function public.records_guard();
