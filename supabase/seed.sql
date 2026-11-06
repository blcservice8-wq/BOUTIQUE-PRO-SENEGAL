-- Données de démonstration — À EXÉCUTER APRÈS avoir créé un compte et une boutique.
-- Usage (éditeur SQL Supabase) :  select charger_donnees_demo('<ID_DE_VOTRE_BOUTIQUE>');
-- Réservé au propriétaire de la boutique. Ne supprime rien ; peut être lancé une seule fois par boutique.

create or replace function charger_donnees_demo(p_boutique uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cat_cereales uuid := gen_random_uuid(); cat_huiles uuid := gen_random_uuid(); cat_boissons uuid := gen_random_uuid(); cat_hygiene uuid := gen_random_uuid();
        four uuid := gen_random_uuid(); p record;
begin
  if not est_proprietaire(p_boutique) then raise exception 'Réservé au propriétaire de la boutique'; end if;
  if exists (select 1 from produits where boutique_id = p_boutique and reference like 'DEMO-%') then raise exception 'Données de démonstration déjà chargées'; end if;
  insert into categories(id, boutique_id, nom) values (cat_cereales, p_boutique, 'Céréales'), (cat_huiles, p_boutique, 'Huiles'), (cat_boissons, p_boutique, 'Boissons'), (cat_hygiene, p_boutique, 'Hygiène')
    on conflict (boutique_id, nom) do nothing;
  insert into fournisseurs(id, boutique_id, nom, telephone) values (four, p_boutique, 'Grossiste Sandaga (démo)', '770000000');
  insert into clients(boutique_id, nom, telephone) values (p_boutique, 'Fatou Ndiaye (démo)', '771111111'), (p_boutique, 'Moussa Diop (démo)', '772222222');
  insert into produits(boutique_id, reference, nom, categorie_id, fournisseur_id, unite, prix_achat, prix_vente, stock_min) values
    (p_boutique, 'DEMO-RIZ50', 'Riz brisé 50 kg', (select id from categories where boutique_id=p_boutique and nom='Céréales'), four, 'sac', 16000, 18000, 3),
    (p_boutique, 'DEMO-SUCRE', 'Sucre 1 kg', (select id from categories where boutique_id=p_boutique and nom='Céréales'), four, 'kg', 600, 750, 20),
    (p_boutique, 'DEMO-HUILE5', 'Huile 5 L', (select id from categories where boutique_id=p_boutique and nom='Huiles'), four, 'unite', 4000, 4800, 5),
    (p_boutique, 'DEMO-EAU', 'Eau minérale 1,5 L', (select id from categories where boutique_id=p_boutique and nom='Boissons'), four, 'unite', 250, 350, 24),
    (p_boutique, 'DEMO-SAVON', 'Savon de ménage', (select id from categories where boutique_id=p_boutique and nom='Hygiène'), four, 'unite', 150, 250, 20);
  for p in select id, stock_min from produits where boutique_id = p_boutique and reference like 'DEMO-%' loop
    insert into mouvements_stock(id, boutique_id, produit_id, type, quantite, document_type, motif, appareil_id, cree_par, survenu_le)
    values (gen_random_uuid(), p_boutique, p.id, 'entree_diverse', p.stock_min * 4, 'demo', 'Stock de démonstration', 'SEED', auth.uid(), now());
  end loop;
  return 'Données de démonstration chargées';
end $$;
revoke all on function charger_donnees_demo(uuid) from public;
grant execute on function charger_donnees_demo(uuid) to authenticated;
