-- Boutique Pro Sénégal — Migration 002 : RPC de synchronisation (idempotente, contrôlée côté serveur)
-- Le client n'écrit JAMAIS directement dans les tables financières : tout passe par appliquer_operation().

-- Types de mouvements de caisse supplémentaires
alter table mouvements_caisse drop constraint if exists mouvements_caisse_type_check;
alter table mouvements_caisse add constraint mouvements_caisse_type_check check (type in
  ('fonds_initial','vente_especes','remboursement_credit','depense','retrait','apport','paiement_fournisseur','annulation_vente'));

create or replace function _verifier_caisse(b uuid, c uuid) returns void
language plpgsql stable as $$
begin
  if c is not null and not exists (select 1 from caisses where id = c and boutique_id = b) then
    raise exception 'Caisse inconnue pour cette boutique';
  end if;
end $$;

create or replace function _mvt_caisse(b uuid, c uuid, t text, s smallint, m numeric, doc uuid, lib text, quand timestamptz, mid uuid)
returns void language plpgsql as $$
begin
  if c is null or m <= 0 then return; end if;
  insert into mouvements_caisse(id, boutique_id, caisse_id, type, sens, montant, document_id, libelle, survenu_le, cree_par)
  values (coalesce(mid, gen_random_uuid()), b, c, t, s, m, doc, lib, quand, auth.uid());
end $$;

-- ---------- VENTE ----------
create or replace function _op_vente(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare
  v_id uuid := (p->>'id')::uuid;
  l jsonb; pay jsonb; prod record;
  sous numeric := 0; remise numeric := coalesce((p->>'remise')::numeric,0);
  total numeric; paye numeric := 0; reste numeric;
  qte numeric; pu numeric; rl numeric; tl numeric;
  stock_actuel numeric; quand timestamptz := (p->>'vendu_le')::timestamptz;
  cid uuid := nullif(p->>'caisse_id','')::uuid;
  client uuid := nullif(p->>'client_id','')::uuid;
  credit_id uuid;
  numero_final text := p->>'numero';
begin
  perform _verifier_caisse(b, cid);
  -- Deux appareils peuvent produire le même numéro : une vente déjà remise au client n'est jamais refusée pour cela.
  if exists (select 1 from ventes where boutique_id = b and numero = numero_final) then
    numero_final := numero_final || '-' || substr(replace(v_id::text, '-', ''), 1, 4);
  end if;
  if client is not null and not exists (select 1 from clients where id = client and boutique_id = b) then
    raise exception 'Client inconnu'; end if;
  if jsonb_array_length(coalesce(p->'lignes','[]'::jsonb)) = 0 then raise exception 'Vente sans article'; end if;

  -- 1. recalcul serveur des montants (le client n'est pas cru sur parole)
  for l in select * from jsonb_array_elements(p->'lignes') loop
    qte := (l->>'quantite')::numeric; pu := (l->>'prix_unitaire')::numeric; rl := coalesce((l->>'remise_ligne')::numeric,0);
    if qte <= 0 or pu < 0 or rl < 0 then raise exception 'Ligne invalide'; end if;
    tl := round(qte * pu) - rl;
    if tl < 0 then raise exception 'Remise de ligne supérieure au montant'; end if;
    sous := sous + tl;
  end loop;
  if remise > sous then raise exception 'Remise supérieure au sous-total'; end if;
  if role_dans(b) = 'caissier' and remise > floor(sous * 0.10) then raise exception 'Remise limitée à 10 %% pour un caissier'; end if;
  total := sous - remise;

  for pay in select * from jsonb_array_elements(coalesce(p->'paiements','[]'::jsonb)) loop
    if (pay->>'mode') = 'credit' then raise exception 'Le crédit n''est pas un paiement'; end if;
    paye := paye + (pay->>'montant')::numeric;
  end loop;
  if paye > total then raise exception 'Paiements (%) supérieurs au total (%)', paye, total; end if;
  if (select count(*) - count(distinct x->>'mode') from jsonb_array_elements(coalesce(p->'paiements','[]'::jsonb)) x) > 0 then
    raise exception 'Un seul paiement par mode autorisé'; end if;
  reste := total - paye;
  if reste > 0 and client is null then raise exception 'Vente à crédit : client obligatoire'; end if;

  insert into ventes(id, boutique_id, numero, appareil_id, caisse_id, client_id, caissier_id, statut,
                     sous_total, remise, total, total_paye, reste_a_payer, vendu_le)
  values (v_id, b, numero_final, appareil, cid, client, auth.uid(), 'valide', sous, remise, total, paye, reste, quand);

  -- 2. lignes + stock
  for l in select * from jsonb_array_elements(p->'lignes') loop
    select * into prod from produits where id = (l->>'produit_id')::uuid and boutique_id = b;
    if not found then raise exception 'Produit inconnu'; end if;
    qte := (l->>'quantite')::numeric; pu := (l->>'prix_unitaire')::numeric; rl := coalesce((l->>'remise_ligne')::numeric,0);
    insert into lignes_vente(id, boutique_id, vente_id, produit_id, designation, quantite, prix_unitaire, prix_achat_unitaire, remise_ligne, total_ligne)
    values ((l->>'id')::uuid, b, v_id, prod.id, prod.nom, qte, pu, prod.prix_achat, rl, round(qte*pu) - rl);

    insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, cout_unitaire, document_type, document_id, appareil_id, cree_par, survenu_le)
    values (gen_random_uuid(), b, prod.id, 'sortie_vente', -qte, prod.prix_achat, 'vente', v_id, appareil, auth.uid(), quand);

    select coalesce(stock,0) into stock_actuel from v_stock_produit where boutique_id = b and produit_id = prod.id;
    if coalesce(stock_actuel,0) < 0 then
      -- Marchandise déjà remise : on n'annule pas la vente, on alerte le responsable.
      insert into journal_activite(boutique_id, utilisateur_id, action, entite, entite_id, details)
      values (b, auth.uid(), 'conflit_stock', 'produits', prod.id,
              jsonb_build_object('vente', v_id, 'stock_apres', stock_actuel, 'tolere', prod.autoriser_stock_negatif));
    end if;
  end loop;

  -- 3. paiements + caisse (seules les espèces entrent dans le tiroir-caisse)
  for pay in select * from jsonb_array_elements(coalesce(p->'paiements','[]'::jsonb)) loop
    insert into paiements_vente(id, boutique_id, vente_id, mode, montant, reference_externe, paye_le)
    values ((pay->>'id')::uuid, b, v_id, (pay->>'mode')::mode_paiement, (pay->>'montant')::numeric, pay->>'reference_externe', quand);
    if (pay->>'mode') = 'especes' then
      perform _mvt_caisse(b, cid, 'vente_especes', 1::smallint, (pay->>'montant')::numeric, v_id, 'Vente '||(p->>'numero'), quand, (pay->>'id')::uuid);
    end if;
  end loop;

  -- 4. crédit : une dette, pas un encaissement
  if reste > 0 then
    insert into credits_clients(id, boutique_id, client_id, vente_id, montant_initial, echeance)
    values (coalesce(nullif(p->>'credit_id','')::uuid, gen_random_uuid()), b, client, v_id, reste, nullif(p->>'echeance','')::date);
  end if;
end $$;

-- ---------- ANNULATION D'UNE VENTE (gestion) ----------
create or replace function _op_annulation_vente(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare v ventes; l record; pv record; quand timestamptz := coalesce((p->>'annule_le')::timestamptz, now());
begin
  select * into v from ventes where id = (p->>'vente_id')::uuid and boutique_id = b for update;
  if not found then raise exception 'Vente inconnue'; end if;
  if v.statut = 'annule' then return; end if;
  if coalesce(trim(p->>'motif'),'') = '' then raise exception 'Motif obligatoire'; end if;
  if exists (select 1 from remboursements_clients r join credits_clients c on c.id = r.credit_id where c.vente_id = v.id) then
    raise exception 'Des remboursements existent sur le crédit de cette vente';
  end if;

  update ventes set statut='annule', annule_le=quand, annule_par=auth.uid(), motif_annulation=p->>'motif' where id = v.id;
  update credits_clients set statut='annule' where vente_id = v.id;

  for l in select * from lignes_vente where vente_id = v.id loop
    insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, cout_unitaire, document_type, document_id, motif, appareil_id, cree_par, survenu_le)
    values (gen_random_uuid(), b, l.produit_id, 'annulation_vente', l.quantite, l.prix_achat_unitaire, 'vente', v.id, p->>'motif', appareil, auth.uid(), quand);
  end loop;
  for pv in select * from paiements_vente where vente_id = v.id and mode = 'especes' loop
    perform _mvt_caisse(b, nullif(p->>'caisse_id','')::uuid, 'annulation_vente', (-1)::smallint, pv.montant, v.id, 'Annulation '||v.numero, quand, nullif(p->>'id','')::uuid);
  end loop;
end $$;

-- ---------- REMBOURSEMENT CLIENT ----------
create or replace function _op_remboursement(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare cr credits_clients; quand timestamptz := (p->>'rembourse_le')::timestamptz; cid uuid := nullif(p->>'caisse_id','')::uuid; reste numeric;
begin
  perform _verifier_caisse(b, cid);
  select * into cr from credits_clients where id = (p->>'credit_id')::uuid and boutique_id = b;
  if not found or cr.statut <> 'ouvert' then raise exception 'Crédit introuvable ou clos'; end if;
  insert into remboursements_clients(id, boutique_id, credit_id, client_id, montant, mode, caisse_id, rembourse_le, cree_par)
  values ((p->>'id')::uuid, b, cr.id, cr.client_id, (p->>'montant')::numeric, (p->>'mode')::mode_paiement, cid, quand, auth.uid());
  if (p->>'mode') = 'especes' then
    perform _mvt_caisse(b, cid, 'remboursement_credit', 1::smallint, (p->>'montant')::numeric, (p->>'id')::uuid, 'Remboursement crédit', quand, (p->>'id')::uuid);
  end if;
  select cr.montant_initial - coalesce(sum(montant),0) into reste from remboursements_clients where credit_id = cr.id;
  if reste <= 0 then update credits_clients set statut='solde' where id = cr.id; end if;
end $$;

-- ---------- DÉPENSE / RETRAIT ----------
create or replace function _op_depense(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare cid uuid := nullif(p->>'caisse_id','')::uuid; quand timestamptz := (p->>'depense_le')::timestamptz; m numeric := (p->>'montant')::numeric;
begin
  perform _verifier_caisse(b, cid);
  insert into depenses(id, boutique_id, caisse_id, categorie, montant, mode, description, depense_le, cree_par)
  values ((p->>'id')::uuid, b, cid, p->>'categorie', m, coalesce(p->>'mode','especes')::mode_paiement, p->>'description', quand, auth.uid());
  if coalesce(p->>'mode','especes') = 'especes' then
    perform _mvt_caisse(b, cid, 'depense', (-1)::smallint, m, (p->>'id')::uuid, p->>'categorie', quand, (p->>'id')::uuid);
  end if;
end $$;

create or replace function _op_retrait(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare cid uuid := (p->>'caisse_id')::uuid;
begin
  perform _verifier_caisse(b, cid);
  perform _mvt_caisse(b, cid, 'retrait', (-1)::smallint, (p->>'montant')::numeric, (p->>'id')::uuid, p->>'libelle', (p->>'survenu_le')::timestamptz, (p->>'id')::uuid);
end $$;

-- ---------- CAISSE ----------
create or replace function _op_ouverture_caisse(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare quand timestamptz := (p->>'ouverte_le')::timestamptz; f numeric := coalesce((p->>'fonds_initial')::numeric,0);
begin
  insert into caisses(id, boutique_id, appareil_id, ouvert_par, ouverte_le, fonds_initial)
  values ((p->>'id')::uuid, b, appareil, auth.uid(), quand, f);
  perform _mvt_caisse(b, (p->>'id')::uuid, 'fonds_initial', 1::smallint, f, (p->>'id')::uuid, 'Fonds initial', quand, (p->>'id')::uuid);
end $$;

create or replace function _op_cloture_caisse(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare c caisses; theo numeric; compte numeric := (p->>'montant_compte')::numeric;
begin
  select * into c from caisses where id = (p->>'caisse_id')::uuid and boutique_id = b for update;
  if not found then raise exception 'Caisse inconnue'; end if;
  if c.statut = 'fermee' then return; end if;
  select coalesce(sum(sens * montant),0) into theo from mouvements_caisse where caisse_id = c.id;
  update caisses set statut='fermee', fermee_le=(p->>'fermee_le')::timestamptz,
         solde_theorique=theo, montant_compte=compte, ecart=compte - theo where id = c.id;
end $$;

-- ---------- ACHATS ----------
create or replace function _op_achat(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare l jsonb; tot numeric := 0; numero_final text := p->>'numero';
begin
  if exists (select 1 from achats where boutique_id = b and numero = numero_final) then
    numero_final := numero_final || '-' || substr(replace((p->>'id'), '-', ''), 1, 4);
  end if;
  if not exists (select 1 from fournisseurs where id = (p->>'fournisseur_id')::uuid and boutique_id = b) then raise exception 'Fournisseur inconnu'; end if;
  for l in select * from jsonb_array_elements(p->'lignes') loop
    tot := tot + round((l->>'quantite_commandee')::numeric * (l->>'prix_achat_unitaire')::numeric);
  end loop;
  insert into achats(id, boutique_id, numero, fournisseur_id, total, commande_le, cree_par)
  values ((p->>'id')::uuid, b, numero_final, (p->>'fournisseur_id')::uuid, tot, (p->>'commande_le')::timestamptz, auth.uid());
  for l in select * from jsonb_array_elements(p->'lignes') loop
    if not exists (select 1 from produits where id = (l->>'produit_id')::uuid and boutique_id = b) then raise exception 'Produit inconnu'; end if;
    insert into lignes_achat(id, boutique_id, achat_id, produit_id, quantite_commandee, prix_achat_unitaire)
    values ((l->>'id')::uuid, b, (p->>'id')::uuid, (l->>'produit_id')::uuid, (l->>'quantite_commandee')::numeric, (l->>'prix_achat_unitaire')::numeric);
  end loop;
end $$;

-- Réception : seul le stock réellement reçu augmente (commande ≠ réception)
create or replace function _op_reception(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare l jsonb; la lignes_achat; quand timestamptz := (p->>'recu_le')::timestamptz; q numeric; restant numeric;
begin
  perform 1 from achats where id = (p->>'achat_id')::uuid and boutique_id = b and statut in ('commande','recu_partiel') for update;
  if not found then raise exception 'Achat introuvable ou déjà clos'; end if;
  for l in select * from jsonb_array_elements(p->'lignes') loop
    q := (l->>'quantite_recue')::numeric;
    if q <= 0 then continue; end if;
    select * into la from lignes_achat where id = (l->>'ligne_id')::uuid and achat_id = (p->>'achat_id')::uuid for update;
    if not found then raise exception 'Ligne d''achat inconnue'; end if;
    if la.quantite_recue + q > la.quantite_commandee then raise exception 'Réception supérieure à la commande'; end if;
    update lignes_achat set quantite_recue = quantite_recue + q, date_peremption = coalesce(nullif(l->>'date_peremption','')::date, date_peremption) where id = la.id;
    insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, cout_unitaire, document_type, document_id, appareil_id, cree_par, survenu_le)
    values (gen_random_uuid(), b, la.produit_id, 'entree_achat', q, la.prix_achat_unitaire, 'achat', la.achat_id, appareil, auth.uid(), quand);
    update produits set prix_achat = la.prix_achat_unitaire,
           date_peremption = coalesce(nullif(l->>'date_peremption','')::date, date_peremption) where id = la.produit_id;
  end loop;
  select sum(quantite_commandee - quantite_recue) into restant from lignes_achat where achat_id = (p->>'achat_id')::uuid;
  update achats set statut = case when restant <= 0 then 'recu' else 'recu_partiel' end, recu_le = quand where id = (p->>'achat_id')::uuid;
end $$;

create or replace function _op_facture_fournisseur(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
begin
  insert into factures_fournisseurs(id, boutique_id, achat_id, fournisseur_id, numero, montant, echeance, emise_le)
  values ((p->>'id')::uuid, b, nullif(p->>'achat_id','')::uuid, (p->>'fournisseur_id')::uuid, p->>'numero',
          (p->>'montant')::numeric, nullif(p->>'echeance','')::date, (p->>'emise_le')::timestamptz);
end $$;

create or replace function _op_paiement_fournisseur(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare v_reste numeric; m numeric := (p->>'montant')::numeric; cid uuid := nullif(p->>'caisse_id','')::uuid; quand timestamptz := (p->>'paye_le')::timestamptz;
begin
  perform 1 from factures_fournisseurs where id = (p->>'facture_id')::uuid and boutique_id = b for update;
  if not found then raise exception 'Facture inconnue'; end if;
  select s.reste into v_reste from v_solde_facture s where s.facture_id = (p->>'facture_id')::uuid;
  if m > v_reste then raise exception 'Paiement supérieur au reste dû (%)', v_reste; end if;
  insert into paiements_fournisseurs(id, boutique_id, facture_id, montant, mode, paye_le, cree_par)
  values ((p->>'id')::uuid, b, (p->>'facture_id')::uuid, m, (p->>'mode')::mode_paiement, quand, auth.uid());
  if v_reste - m <= 0 then update factures_fournisseurs set statut='soldee' where id = (p->>'facture_id')::uuid; end if;
  if (p->>'mode') = 'especes' then
    perform _verifier_caisse(b, cid);
    perform _mvt_caisse(b, cid, 'paiement_fournisseur', (-1)::smallint, m, (p->>'id')::uuid, 'Paiement fournisseur', quand, (p->>'id')::uuid);
  end if;
end $$;

-- ---------- STOCK : ajustement & inventaire (gestion) ----------
create or replace function _op_ajustement_stock(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
begin
  if coalesce(trim(p->>'motif'),'') = '' then raise exception 'Motif obligatoire pour un ajustement'; end if;
  if not exists (select 1 from produits where id = (p->>'produit_id')::uuid and boutique_id = b) then raise exception 'Produit inconnu'; end if;
  insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, document_type, motif, appareil_id, cree_par, survenu_le)
  values ((p->>'id')::uuid, b, (p->>'produit_id')::uuid, (p->>'type')::type_mvt_stock, (p->>'quantite')::numeric,
          'ajustement', p->>'motif', appareil, auth.uid(), (p->>'survenu_le')::timestamptz);
end $$;

create or replace function _op_inventaire(b uuid, appareil text, p jsonb) returns void
language plpgsql as $$
declare l jsonb; theo numeric; compte numeric; ec numeric; quand timestamptz := (p->>'realise_le')::timestamptz;
begin
  insert into inventaires(id, boutique_id, statut, realise_le, cree_par, notes) values ((p->>'id')::uuid, b, 'valide', quand, auth.uid(), p->>'notes');
  for l in select * from jsonb_array_elements(p->'lignes') loop
    select coalesce(stock,0) into theo from v_stock_produit where boutique_id = b and produit_id = (l->>'produit_id')::uuid;
    theo := coalesce(theo,0); compte := (l->>'quantite_comptee')::numeric; ec := compte - theo;
    insert into lignes_inventaire(id, boutique_id, inventaire_id, produit_id, quantite_theorique, quantite_comptee, ecart)
    values ((l->>'id')::uuid, b, (p->>'id')::uuid, (l->>'produit_id')::uuid, theo, compte, ec);
    if ec <> 0 then
      insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, document_type, document_id, motif, appareil_id, cree_par, survenu_le)
      values (gen_random_uuid(), b, (l->>'produit_id')::uuid, 'inventaire', ec, 'inventaire', (p->>'id')::uuid, 'Écart d''inventaire', appareil, auth.uid(), quand);
    end if;
  end loop;
end $$;

-- ============ POINT D'ENTRÉE UNIQUE ============
create or replace function appliquer_operation(p_boutique uuid, p_op_id uuid, p_type text, p_appareil text, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare r role_boutique; n int;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  r := role_dans(p_boutique);
  if r is null then raise exception 'Accès refusé à cette boutique'; end if;

  -- Droits par rôle, vérifiés côté serveur
  if p_type in ('vente','remboursement','ouverture_caisse','cloture_caisse') then null;                       -- tous les rôles
  elsif p_type in ('annulation_vente','depense','retrait','achat','reception','facture_fournisseur',
                   'paiement_fournisseur','ajustement_stock','inventaire') then
    if r = 'caissier' then raise exception 'Droits insuffisants pour % (rôle caissier)', p_type; end if;
  else raise exception 'Type d''opération inconnu : %', p_type; end if;

  -- Idempotence : une opération déjà reçue n'est jamais rejouée
  insert into operations_sync(boutique_id, op_id, type, appareil_id, utilisateur_id)
  values (p_boutique, p_op_id, p_type, p_appareil, auth.uid()) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'deja_applique'; end if;

  case p_type
    when 'vente' then perform _op_vente(p_boutique, p_appareil, p_payload);
    when 'annulation_vente' then perform _op_annulation_vente(p_boutique, p_appareil, p_payload);
    when 'remboursement' then perform _op_remboursement(p_boutique, p_appareil, p_payload);
    when 'depense' then perform _op_depense(p_boutique, p_appareil, p_payload);
    when 'retrait' then perform _op_retrait(p_boutique, p_appareil, p_payload);
    when 'ouverture_caisse' then perform _op_ouverture_caisse(p_boutique, p_appareil, p_payload);
    when 'cloture_caisse' then perform _op_cloture_caisse(p_boutique, p_appareil, p_payload);
    when 'achat' then perform _op_achat(p_boutique, p_appareil, p_payload);
    when 'reception' then perform _op_reception(p_boutique, p_appareil, p_payload);
    when 'facture_fournisseur' then perform _op_facture_fournisseur(p_boutique, p_appareil, p_payload);
    when 'paiement_fournisseur' then perform _op_paiement_fournisseur(p_boutique, p_appareil, p_payload);
    when 'ajustement_stock' then perform _op_ajustement_stock(p_boutique, p_appareil, p_payload);
    when 'inventaire' then perform _op_inventaire(p_boutique, p_appareil, p_payload);
  end case;

  insert into journal_activite(boutique_id, utilisateur_id, action, entite, entite_id, details)
  values (p_boutique, auth.uid(), p_type, 'operation', p_op_id, jsonb_build_object('appareil', p_appareil));
  insert into etat_synchronisation(boutique_id, appareil_id, derniere_synchro) values (p_boutique, p_appareil, now())
  on conflict (boutique_id, appareil_id) do update set derniere_synchro = now();
  return 'ok';
end $$;

revoke all on function appliquer_operation(uuid,uuid,text,text,jsonb) from public;
grant execute on function appliquer_operation(uuid,uuid,text,text,jsonb) to authenticated;
-- Les fonctions _op_* ne sont pas exposées : réservées à appliquer_operation (appelées avec les droits du propriétaire de la fonction).
revoke all on function _op_vente(uuid,text,jsonb), _op_annulation_vente(uuid,text,jsonb), _op_remboursement(uuid,text,jsonb),
  _op_depense(uuid,text,jsonb), _op_retrait(uuid,text,jsonb), _op_ouverture_caisse(uuid,text,jsonb), _op_cloture_caisse(uuid,text,jsonb),
  _op_achat(uuid,text,jsonb), _op_reception(uuid,text,jsonb), _op_facture_fournisseur(uuid,text,jsonb),
  _op_paiement_fournisseur(uuid,text,jsonb), _op_ajustement_stock(uuid,text,jsonb), _op_inventaire(uuid,text,jsonb),
  _mvt_caisse(uuid,uuid,text,smallint,numeric,uuid,text,timestamptz,uuid), _verifier_caisse(uuid,uuid) from public, anon, authenticated;
