-- Boutique Pro Sénégal — Migration 003 : curseurs de synchro, création de boutique « adoptable », gestion des membres

-- 1) maj_le sur toutes les tables documentaires (curseur de pull incrémental)
do $$ declare t text; begin
  foreach t in array array['ventes','lignes_vente','paiements_vente','credits_clients','remboursements_clients','achats','lignes_achat',
    'factures_fournisseurs','paiements_fournisseurs','mouvements_stock','inventaires','lignes_inventaire','mouvements_caisse','depenses','caisses'] loop
    execute format('alter table %I add column if not exists maj_le timestamptz not null default now()', t);
    execute format('create index if not exists idx_%s_maj on %I(boutique_id, maj_le)', t, t);
  end loop;
  -- tables modifiables : maj_le mis à jour automatiquement
  foreach t in array array['ventes','credits_clients','achats','lignes_achat','factures_fournisseurs','caisses'] loop
    execute format('drop trigger if exists trg_maj on %I', t);
    execute format('create trigger trg_maj before update on %I for each row execute function maj_horodatage()', t);
  end loop;
end $$;

-- 2) Création de boutique : id fourni par l'appareil (adopte les données créées en mode local)
drop function if exists creer_boutique(text);
create or replace function creer_boutique(p_nom text, p_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if exists (select 1 from boutiques where id = b) then raise exception 'Cette boutique existe déjà'; end if;
  insert into boutiques(id, nom, cree_par) values (b, p_nom, auth.uid());
  insert into membres_boutiques(boutique_id, utilisateur_id, role) values (b, auth.uid(), 'proprietaire');
  insert into journal_activite(boutique_id, utilisateur_id, action, entite, entite_id) values (b, auth.uid(), 'creation_boutique','boutiques', b);
  return b;
end $$;
revoke all on function creer_boutique(text, uuid) from public;
grant execute on function creer_boutique(text, uuid) to authenticated;

-- 3) Ajout d'un membre par e-mail (propriétaire uniquement ; le compte doit déjà exister)
create or replace function ajouter_membre(p_boutique uuid, p_email text, p_role role_boutique) returns void
language plpgsql security definer set search_path = public, auth as $$
declare u uuid;
begin
  if not est_proprietaire(p_boutique) then raise exception 'Réservé au propriétaire'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'Aucun compte avec cet e-mail : la personne doit d''abord créer son compte'; end if;
  insert into membres_boutiques(boutique_id, utilisateur_id, role) values (p_boutique, u, p_role)
  on conflict (boutique_id, utilisateur_id) do update set role = excluded.role, actif = true;
  insert into journal_activite(boutique_id, utilisateur_id, action, entite, entite_id, details)
  values (p_boutique, auth.uid(), 'ajout_membre', 'membres_boutiques', u, jsonb_build_object('role', p_role));
end $$;
revoke all on function ajouter_membre(uuid, text, role_boutique) from public;
grant execute on function ajouter_membre(uuid, text, role_boutique) to authenticated;

-- Liste des membres avec e-mail (propriétaire uniquement)
create or replace function lister_membres(p_boutique uuid)
returns table(utilisateur_id uuid, email text, role role_boutique, actif boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not est_proprietaire(p_boutique) then raise exception 'Réservé au propriétaire'; end if;
  return query select m.utilisateur_id, u.email::text, m.role, m.actif
    from membres_boutiques m join auth.users u on u.id = m.utilisateur_id where m.boutique_id = p_boutique order by u.email;
end $$;
revoke all on function lister_membres(uuid) from public;
grant execute on function lister_membres(uuid) to authenticated;

-- 4) Impossible de retirer ou rétrograder le dernier propriétaire
create or replace function proteger_dernier_proprietaire() returns trigger language plpgsql as $$
begin
  if old.role = 'proprietaire' and old.actif and
     (tg_op = 'DELETE' or new.role <> 'proprietaire' or not new.actif) and
     not exists (select 1 from membres_boutiques where boutique_id = old.boutique_id and role = 'proprietaire' and actif
                 and utilisateur_id <> old.utilisateur_id) then
    raise exception 'Une boutique doit conserver au moins un propriétaire';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_dernier_proprietaire on membres_boutiques;
create trigger trg_dernier_proprietaire before update or delete on membres_boutiques for each row execute function proteger_dernier_proprietaire();

-- 5) Profil créé automatiquement à l'inscription
create or replace function nouveau_utilisateur() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profils_utilisateurs(id, nom_complet) values (new.id, coalesce(new.raw_user_meta_data->>'nom_complet', new.email))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_nouveau_utilisateur on auth.users;
create trigger trg_nouveau_utilisateur after insert on auth.users for each row execute function nouveau_utilisateur();
