-- Boutique Pro Sénégal — Migration 001 : schéma complet (PostgreSQL / Supabase)
-- Exécuter dans l'éditeur SQL Supabase. Idempotent autant que possible.

-- gen_random_uuid() est natif depuis PostgreSQL 13 (pas d'extension requise)

-- ============ TYPES ============
do $$ begin
  create type role_boutique as enum ('proprietaire','gerant','caissier');
exception when duplicate_object then null; end $$;
do $$ begin
  create type statut_doc as enum ('brouillon','valide','annule');
exception when duplicate_object then null; end $$;
do $$ begin
  create type mode_paiement as enum ('especes','wave','orange_money','autre_mobile','credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type type_mvt_stock as enum ('entree_achat','sortie_vente','annulation_vente','ajustement','inventaire','perte','casse','peremption','entree_diverse','sortie_diverse');
exception when duplicate_object then null; end $$;

-- ============ BOUTIQUES & MEMBRES ============
create table if not exists boutiques (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) > 0),
  telephone text, adresse text, logo_url text,
  pied_ticket text, devise text not null default 'XOF',
  cree_par uuid not null references auth.users(id),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

create table if not exists profils_utilisateurs (
  id uuid primary key references auth.users(id) on delete cascade,
  nom_complet text, telephone text,
  cree_le timestamptz not null default now()
);

create table if not exists membres_boutiques (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  utilisateur_id uuid not null references auth.users(id) on delete cascade,
  role role_boutique not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (boutique_id, utilisateur_id)
);
create index if not exists idx_membres_user on membres_boutiques(utilisateur_id) where actif;

-- ============ FONCTIONS D'AUTORISATION ============
create or replace function role_dans(b uuid) returns role_boutique
language sql stable security definer set search_path = public as $$
  select role from membres_boutiques
  where boutique_id = b and utilisateur_id = auth.uid() and actif
$$;

create or replace function est_membre(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membres_boutiques
    where boutique_id = b and utilisateur_id = auth.uid() and actif)
$$;

create or replace function est_gestion(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(role_dans(b) in ('proprietaire','gerant'), false)
$$;

create or replace function est_proprietaire(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(role_dans(b) = 'proprietaire', false)
$$;

-- ============ RÉFÉRENTIELS ============
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  nom text not null, version int not null default 1,
  supprime_le timestamptz, cree_le timestamptz not null default now(), maj_le timestamptz not null default now(),
  unique (boutique_id, nom)
);

create table if not exists fournisseurs (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  nom text not null, telephone text, adresse text, notes text,
  version int not null default 1,
  supprime_le timestamptz, cree_le timestamptz not null default now(), maj_le timestamptz not null default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  nom text not null, telephone text, adresse text,
  plafond_credit numeric(14,0) check (plafond_credit is null or plafond_credit >= 0),
  version int not null default 1,
  supprime_le timestamptz, cree_le timestamptz not null default now(), maj_le timestamptz not null default now()
);
create index if not exists idx_clients_nom on clients(boutique_id, nom);

create table if not exists produits (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  reference text not null,
  code_barres text,
  nom text not null,
  categorie_id uuid references categories(id),
  fournisseur_id uuid references fournisseurs(id),
  unite text not null default 'unite' check (unite in ('unite','kg','litre','paquet','carton','sac')),
  -- Conversion contrôlée : un carton de N unités de base. NULL = pas de conditionnement.
  unite_base text, qte_par_conditionnement numeric(12,3) check (qte_par_conditionnement is null or qte_par_conditionnement > 0),
  prix_achat numeric(14,0) not null default 0 check (prix_achat >= 0),
  prix_vente numeric(14,0) not null default 0 check (prix_vente >= 0),
  stock_min numeric(14,3) not null default 0 check (stock_min >= 0),
  autoriser_stock_negatif boolean not null default false,
  date_peremption date,
  version int not null default 1,
  supprime_le timestamptz,
  cree_le timestamptz not null default now(), maj_le timestamptz not null default now(),
  unique (boutique_id, reference)
);
create unique index if not exists uq_produits_codebarres on produits(boutique_id, code_barres) where code_barres is not null and supprime_le is null;
create index if not exists idx_produits_nom on produits(boutique_id, lower(nom));

-- ============ CAISSES ============
create table if not exists caisses (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  appareil_id text not null,
  ouvert_par uuid not null references auth.users(id),
  ouverte_le timestamptz not null default now(),
  fonds_initial numeric(14,0) not null default 0 check (fonds_initial >= 0),
  fermee_le timestamptz,
  solde_theorique numeric(14,0),
  montant_compte numeric(14,0) check (montant_compte is null or montant_compte >= 0),
  ecart numeric(14,0),
  statut text not null default 'ouverte' check (statut in ('ouverte','fermee')),
  maj_le timestamptz not null default now()
);
create index if not exists idx_caisses_b on caisses(boutique_id, ouverte_le desc);

-- ============ VENTES ============
create table if not exists ventes (
  id uuid primary key,                         -- UUID généré hors ligne
  boutique_id uuid not null references boutiques(id) on delete cascade,
  numero text not null,                        -- ex. A1-20261028-0007
  appareil_id text not null,
  caisse_id uuid references caisses(id),
  client_id uuid references clients(id),
  caissier_id uuid not null references auth.users(id),
  statut statut_doc not null default 'valide',
  sous_total numeric(14,0) not null check (sous_total >= 0),
  remise numeric(14,0) not null default 0 check (remise >= 0),
  total numeric(14,0) not null check (total >= 0),
  total_paye numeric(14,0) not null default 0 check (total_paye >= 0),
  reste_a_payer numeric(14,0) not null default 0 check (reste_a_payer >= 0),
  vendu_le timestamptz not null,
  annule_le timestamptz, annule_par uuid references auth.users(id), motif_annulation text,
  cree_le timestamptz not null default now(),
  check (remise <= sous_total),
  check (total = sous_total - remise),
  check (total_paye + reste_a_payer >= total or statut = 'annule'),
  unique (boutique_id, numero)
);
create index if not exists idx_ventes_date on ventes(boutique_id, vendu_le desc);
create index if not exists idx_ventes_client on ventes(client_id) where client_id is not null;

create table if not exists lignes_vente (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  vente_id uuid not null references ventes(id) on delete cascade,
  produit_id uuid not null references produits(id),
  designation text not null,
  quantite numeric(14,3) not null check (quantite > 0),
  prix_unitaire numeric(14,0) not null check (prix_unitaire >= 0),
  prix_achat_unitaire numeric(14,0) not null default 0 check (prix_achat_unitaire >= 0), -- figé pour la marge
  remise_ligne numeric(14,0) not null default 0 check (remise_ligne >= 0),
  total_ligne numeric(14,0) not null check (total_ligne >= 0)
);
create index if not exists idx_lv_vente on lignes_vente(vente_id);
create index if not exists idx_lv_produit on lignes_vente(boutique_id, produit_id);

create table if not exists paiements_vente (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  vente_id uuid not null references ventes(id) on delete cascade,
  mode mode_paiement not null,
  montant numeric(14,0) not null check (montant > 0),
  reference_externe text,                      -- n° transaction Wave/OM saisi à la main
  paye_le timestamptz not null
);
create index if not exists idx_pv_vente on paiements_vente(vente_id);

-- ============ CRÉDITS CLIENTS ============
create table if not exists credits_clients (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  client_id uuid not null references clients(id),
  vente_id uuid references ventes(id),
  montant_initial numeric(14,0) not null check (montant_initial > 0),
  echeance date,
  statut text not null default 'ouvert' check (statut in ('ouvert','solde','annule')),
  cree_le timestamptz not null default now()
);
create index if not exists idx_credits_client on credits_clients(boutique_id, client_id);

create table if not exists remboursements_clients (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  credit_id uuid not null references credits_clients(id),
  client_id uuid not null references clients(id),
  montant numeric(14,0) not null check (montant > 0),
  mode mode_paiement not null check (mode <> 'credit'),
  caisse_id uuid references caisses(id),
  rembourse_le timestamptz not null,
  cree_par uuid not null references auth.users(id)
);
create index if not exists idx_remb_credit on remboursements_clients(credit_id);

-- ============ ACHATS ============
create table if not exists achats (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  numero text not null,
  fournisseur_id uuid not null references fournisseurs(id),
  statut text not null default 'commande' check (statut in ('commande','recu_partiel','recu','annule')),
  total numeric(14,0) not null default 0 check (total >= 0),
  commande_le timestamptz not null,
  recu_le timestamptz,
  cree_par uuid not null references auth.users(id),
  unique (boutique_id, numero)
);

create table if not exists lignes_achat (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  achat_id uuid not null references achats(id) on delete cascade,
  produit_id uuid not null references produits(id),
  quantite_commandee numeric(14,3) not null check (quantite_commandee > 0),
  quantite_recue numeric(14,3) not null default 0 check (quantite_recue >= 0),
  prix_achat_unitaire numeric(14,0) not null check (prix_achat_unitaire >= 0),
  date_peremption date
);

create table if not exists factures_fournisseurs (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  achat_id uuid references achats(id),
  fournisseur_id uuid not null references fournisseurs(id),
  numero text not null,
  montant numeric(14,0) not null check (montant > 0),
  echeance date,
  statut text not null default 'ouverte' check (statut in ('ouverte','soldee','annulee')),
  emise_le timestamptz not null,
  unique (boutique_id, fournisseur_id, numero)
);

create table if not exists paiements_fournisseurs (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  facture_id uuid not null references factures_fournisseurs(id),
  montant numeric(14,0) not null check (montant > 0),
  mode mode_paiement not null check (mode <> 'credit'),
  paye_le timestamptz not null,
  cree_par uuid not null references auth.users(id)
);

-- ============ STOCK (registre en ajout seul) ============
create table if not exists mouvements_stock (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  produit_id uuid not null references produits(id),
  type type_mvt_stock not null,
  quantite numeric(14,3) not null check (quantite <> 0),   -- signée : + entrée, − sortie
  cout_unitaire numeric(14,0),
  document_type text, document_id uuid,
  motif text,
  appareil_id text not null,
  cree_par uuid not null references auth.users(id),
  survenu_le timestamptz not null,
  cree_le timestamptz not null default now()
);
create index if not exists idx_ms_produit on mouvements_stock(boutique_id, produit_id, survenu_le desc);
create index if not exists idx_ms_doc on mouvements_stock(document_id);

create table if not exists inventaires (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  statut text not null default 'en_cours' check (statut in ('en_cours','valide','annule')),
  realise_le timestamptz not null,
  cree_par uuid not null references auth.users(id),
  notes text
);
create table if not exists lignes_inventaire (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  inventaire_id uuid not null references inventaires(id) on delete cascade,
  produit_id uuid not null references produits(id),
  quantite_theorique numeric(14,3) not null,
  quantite_comptee numeric(14,3) not null check (quantite_comptee >= 0),
  ecart numeric(14,3) not null
);

-- ============ CAISSE & DÉPENSES ============
create table if not exists mouvements_caisse (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  caisse_id uuid not null references caisses(id),
  type text not null check (type in ('fonds_initial','vente_especes','remboursement_credit','depense','retrait','apport','paiement_fournisseur')),
  sens smallint not null check (sens in (1,-1)),
  montant numeric(14,0) not null check (montant > 0),
  document_id uuid, libelle text,
  survenu_le timestamptz not null,
  cree_par uuid not null references auth.users(id)
);
create index if not exists idx_mc_caisse on mouvements_caisse(caisse_id);

create table if not exists depenses (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  caisse_id uuid references caisses(id),
  categorie text not null check (categorie in ('transport','electricite','eau','loyer','telephone','reparation','salaires','autres')),
  montant numeric(14,0) not null check (montant > 0),
  mode mode_paiement not null default 'especes' check (mode <> 'credit'),
  description text,
  depense_le timestamptz not null,
  statut statut_doc not null default 'valide',
  cree_par uuid not null references auth.users(id)
);
create index if not exists idx_dep_date on depenses(boutique_id, depense_le desc);

-- ============ TRAÇABILITÉ & SYNC ============
create table if not exists journal_activite (
  id bigint generated always as identity primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  utilisateur_id uuid references auth.users(id),
  action text not null, entite text, entite_id uuid, details jsonb,
  cree_le timestamptz not null default now()
);
create index if not exists idx_journal on journal_activite(boutique_id, cree_le desc);

-- Registre d'idempotence : (boutique, op_id) unique => aucun doublon à la resynchronisation
create table if not exists operations_sync (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  op_id uuid not null,
  type text not null,
  appareil_id text not null,
  utilisateur_id uuid not null references auth.users(id),
  recu_le timestamptz not null default now(),
  primary key (boutique_id, op_id)
);

create table if not exists etat_synchronisation (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  appareil_id text not null,
  derniere_synchro timestamptz,
  derniere_sauvegarde timestamptz,
  primary key (boutique_id, appareil_id)
);

-- ============ VUES DE CALCUL (le serveur dérive, le client ne saisit pas) ============
create or replace view v_stock_produit with (security_invoker = true) as
  select boutique_id, produit_id, coalesce(sum(quantite),0) as stock
  from mouvements_stock group by boutique_id, produit_id;

create or replace view v_solde_client with (security_invoker = true) as
  select c.boutique_id, c.id as client_id,
    coalesce((select sum(montant_initial) from credits_clients cr where cr.client_id=c.id and cr.statut<>'annule'),0)
  - coalesce((select sum(r.montant) from remboursements_clients r where r.client_id=c.id),0) as solde
  from clients c;

create or replace view v_solde_facture with (security_invoker = true) as
  select f.id as facture_id, f.boutique_id, f.fournisseur_id,
    f.montant - coalesce((select sum(p.montant) from paiements_fournisseurs p where p.facture_id=f.id),0) as reste
  from factures_fournisseurs f where f.statut<>'annulee';

-- ============ TRIGGERS ============
create or replace function maj_horodatage() returns trigger language plpgsql as $$
begin new.maj_le := now(); if tg_op='UPDATE' and to_jsonb(new) ? 'version' then new.version := old.version + 1; end if; return new; end $$;

do $$ declare t text; begin
  foreach t in array array['boutiques','categories','fournisseurs','clients','produits','caisses'] loop
    execute format('drop trigger if exists trg_maj on %I', t);
    execute format('create trigger trg_maj before update on %I for each row execute function maj_horodatage()', t);
  end loop;
end $$;

-- Documents financiers validés : pas de suppression, pas de modification des montants
create or replace function proteger_vente() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Suppression interdite : annulez la vente'; end if;
  if old.statut = 'valide' and (new.total <> old.total or new.sous_total <> old.sous_total or new.remise <> old.remise or new.client_id is distinct from old.client_id) then
    raise exception 'Montants d''une vente validée non modifiables';
  end if;
  if old.statut = 'annule' and new.statut <> 'annule' then raise exception 'Vente annulée non réactivable'; end if;
  return new;
end $$;
drop trigger if exists trg_proteger_vente on ventes;
create trigger trg_proteger_vente before update or delete on ventes for each row execute function proteger_vente();

create or replace function interdire_modif() returns trigger language plpgsql as $$
begin raise exception 'Table en ajout seul : % interdit sur %', tg_op, tg_table_name; end $$;
do $$ declare t text; begin
  foreach t in array array['mouvements_stock','paiements_vente','remboursements_clients','paiements_fournisseurs','mouvements_caisse','journal_activite','lignes_vente'] loop
    execute format('drop trigger if exists trg_append_only on %I', t);
    execute format('create trigger trg_append_only before update or delete on %I for each row execute function interdire_modif()', t);
  end loop;
end $$;

-- Un remboursement ne peut pas dépasser le reste dû du crédit
create or replace function verifier_remboursement() returns trigger language plpgsql as $$
declare reste numeric;
begin
  select cr.montant_initial - coalesce((select sum(montant) from remboursements_clients where credit_id = new.credit_id),0)
    into reste from credits_clients cr where cr.id = new.credit_id for update;
  if new.montant > reste then raise exception 'Remboursement (%) supérieur au reste dû (%)', new.montant, reste; end if;
  return new;
end $$;
drop trigger if exists trg_verif_remb on remboursements_clients;
create trigger trg_verif_remb before insert on remboursements_clients for each row execute function verifier_remboursement();

-- ============ RLS ============
do $$ declare t text; begin
  foreach t in array array['boutiques','profils_utilisateurs','membres_boutiques','categories','fournisseurs','clients','produits','caisses','ventes','lignes_vente','paiements_vente','credits_clients','remboursements_clients','achats','lignes_achat','factures_fournisseurs','paiements_fournisseurs','mouvements_stock','inventaires','lignes_inventaire','mouvements_caisse','depenses','journal_activite','operations_sync','etat_synchronisation'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- boutiques / membres / profils
drop policy if exists p_b_sel on boutiques;  create policy p_b_sel on boutiques for select using (est_membre(id));
drop policy if exists p_b_ins on boutiques;  create policy p_b_ins on boutiques for insert with check (cree_par = auth.uid());
drop policy if exists p_b_upd on boutiques;  create policy p_b_upd on boutiques for update using (est_proprietaire(id));
drop policy if exists p_m_sel on membres_boutiques; create policy p_m_sel on membres_boutiques for select using (utilisateur_id = auth.uid() or est_proprietaire(boutique_id));
drop policy if exists p_m_all on membres_boutiques; create policy p_m_all on membres_boutiques for all using (est_proprietaire(boutique_id)) with check (est_proprietaire(boutique_id));
drop policy if exists p_pr_sel on profils_utilisateurs; create policy p_pr_sel on profils_utilisateurs for select using (id = auth.uid());
drop policy if exists p_pr_all on profils_utilisateurs; create policy p_pr_all on profils_utilisateurs for all using (id = auth.uid()) with check (id = auth.uid());

-- Référentiels : lecture membres ; écriture gestion (clients : caissier peut créer)
do $$ declare t text; begin
  foreach t in array array['categories','fournisseurs','produits'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('create policy p_sel on %I for select using (est_membre(boutique_id))', t);
    execute format('drop policy if exists p_w on %I', t);
    execute format('create policy p_w on %I for all using (est_gestion(boutique_id)) with check (est_gestion(boutique_id))', t);
  end loop;
end $$;
drop policy if exists p_cl_sel on clients; create policy p_cl_sel on clients for select using (est_membre(boutique_id));
drop policy if exists p_cl_ins on clients; create policy p_cl_ins on clients for insert with check (est_membre(boutique_id));
drop policy if exists p_cl_upd on clients; create policy p_cl_upd on clients for update using (est_gestion(boutique_id));

-- Opérations commerciales : lecture membres ; l'écriture passe par la RPC appliquer_operation (security definer)
-- → aucune policy INSERT/UPDATE/DELETE directe pour ces tables.
do $$ declare t text; begin
  foreach t in array array['caisses','ventes','lignes_vente','paiements_vente','credits_clients','remboursements_clients','mouvements_stock','mouvements_caisse','depenses','inventaires','lignes_inventaire','operations_sync','etat_synchronisation'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('create policy p_sel on %I for select using (est_membre(boutique_id))', t);
  end loop;
  foreach t in array array['achats','lignes_achat','factures_fournisseurs','paiements_fournisseurs','journal_activite'] loop
    execute format('drop policy if exists p_sel on %I', t);
    execute format('create policy p_sel on %I for select using (est_gestion(boutique_id))', t);
  end loop;
end $$;

-- Un caissier ne voit que ses propres ventes
drop policy if exists p_sel on ventes;
create policy p_sel on ventes for select using (est_gestion(boutique_id) or (est_membre(boutique_id) and caissier_id = auth.uid()));

-- ============ CRÉATION DE BOUTIQUE ============
create or replace function creer_boutique(p_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  insert into boutiques(nom, cree_par) values (p_nom, auth.uid()) returning id into b;
  insert into membres_boutiques(boutique_id, utilisateur_id, role) values (b, auth.uid(), 'proprietaire');
  insert into journal_activite(boutique_id, utilisateur_id, action, entite, entite_id) values (b, auth.uid(), 'creation_boutique','boutiques', b);
  return b;
end $$;
revoke all on function creer_boutique(text) from public;
grant execute on function creer_boutique(text) to authenticated;

-- ============ RPC DE SYNCHRONISATION (idempotente) ============
-- Reçoit une opération du client. Retourne 'ok' ou 'deja_applique'.
-- Les types sont ajoutés dans 002_rpc_operations.sql (vente, annulation_vente, achat, reception, depense, ...).
