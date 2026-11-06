import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { stocksAffiches } from '../services/stock.js';
import { peut } from '../services/session.js';
import { statutStock } from '../services/calculs.js';
import { versCSV, lireCSV, telechargerTexte } from '../utils/csv.js';
import { $, $$, esc, toast, erreurUtilisateur, agir, modal, confirmer, saisie, entier, decimal } from '../ui.js';
import { fcfa, qte, dateFR, LIBELLE_UNITE } from '../utils/format.js';

export async function afficher(vue) {
  const ecrire = peut('produit_ecrire');
  vue.innerHTML = `<div class="carte"><div class="ligne"><div><label for="q">Recherche</label><input id="q" type="search" placeholder="Nom, référence, code-barres"></div>
    <div><label for="fc">Catégorie</label><select id="fc"><option value="">Toutes</option></select></div>
    <div class="fixe flex">${ecrire ? '<button class="btn p" id="nouveau">+ Produit</button><button class="btn" id="cats">Catégories</button><button class="btn" id="imp">Importer CSV</button>' : ''}<button class="btn" id="exp">Exporter CSV</button></div></div>
    <input type="file" id="fichier" accept=".csv,text/csv" hidden></div><div class="carte"><div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Produit</th><th>Catégorie</th><th>Unité</th><th class="n">P. achat</th><th class="n">P. vente</th><th class="n">Stock</th><th>Péremption</th><th></th></tr></thead><tbody id="corps"></tbody></table></div></div>`;
  let produits = [], stocks = new Map(), cats = new Map();
  const charger = async () => {
    produits = (await db.produits.toArray()).filter(p => !p.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')); stocks = await stocksAffiches();
    cats = new Map((await db.categories.toArray()).filter(c => !c.supprime_le).map(c => [c.id, c.nom]));
    $('#fc', vue).innerHTML = '<option value="">Toutes</option>' + [...cats].map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(''); dessiner();
  };
  const dessiner = () => {
    const t = $('#q', vue).value.toLowerCase(), c = $('#fc', vue).value;
    const l = produits.filter(p => (!c || p.categorie_id === c) && (!t || [p.nom, p.reference, p.code_barres].some(x => (x || '').toLowerCase().includes(t))));
    $('#corps', vue).innerHTML = l.length ? l.map(p => { const s = stocks.get(p.id) || 0, st = statutStock(s, p.stock_min), per = p.date_peremption && Date.parse(p.date_peremption) < Date.now();
      return `<tr><td>${esc(p.reference)}</td><td>${esc(p.nom)}${p.qte_par_conditionnement ? ` <span class="mini">(1 ${LIBELLE_UNITE[p.unite]} = ${p.qte_par_conditionnement} ${esc(p.unite_base || 'u')})</span>` : ''}</td><td>${esc(cats.get(p.categorie_id) || '')}</td><td>${LIBELLE_UNITE[p.unite]}</td><td class="n">${fcfa(p.prix_achat)}</td><td class="n">${fcfa(p.prix_vente)}</td>
      <td class="n"><span class="badge ${st === 'ok' ? 'ok' : st === 'bas' ? 'warn' : 'err'}">${qte(s)}</span></td><td>${p.date_peremption ? `<span class="${per ? 'badge err' : ''}">${dateFR(p.date_peremption)}</span>` : ''}</td>
      <td class="flex">${ecrire ? `<button class="btn s" data-e="${p.id}">Modifier</button><button class="btn s d" data-s="${p.id}">Suppr.</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="9" class="vide">Aucun produit. Ajoutez-en ou importez un fichier CSV.</td></tr>';
    $$('[data-e]', vue).forEach(b => b.onclick = () => formulaire(produits.find(p => p.id === b.dataset.e)));
    $$('[data-s]', vue).forEach(b => b.onclick = async () => { if (await confirmer('Supprimer ce produit ? Son historique de ventes est conservé.', { danger: true, texte: 'Supprimer' })) { try { await ops.supprimerProduit(b.dataset.s); toast('Produit supprimé', 'ok'); charger(); } catch (e) { erreurUtilisateur(e); } } });
  };
  async function formulaire(p = null) {
    const cl = [...cats].map(([id, n]) => `<option value="${id}" ${p?.categorie_id === id ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const fo = (await db.fournisseurs.toArray()).filter(f => !f.supprime_le).map(f => `<option value="${f.id}" ${p?.fournisseur_id === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('');
    modal({ titre: p ? 'Modifier le produit' : 'Nouveau produit', corps: `<form id="fp"><div class="ligne"><div class="champ"><label for="f-nom">Nom *</label><input id="f-nom" name="nom" required maxlength="100" value="${esc(p?.nom)}"></div><div class="champ"><label for="f-ref">Référence * (unique)</label><input id="f-ref" name="reference" required maxlength="40" value="${esc(p?.reference)}"></div></div>
      <div class="ligne"><div class="champ"><label for="f-cb">Code-barres</label><input id="f-cb" name="code_barres" inputmode="numeric" value="${esc(p?.code_barres)}"></div><div class="champ"><label for="f-cat">Catégorie</label><select id="f-cat" name="categorie_id"><option value="">—</option>${cl}</select></div></div>
      <div class="ligne"><div class="champ"><label for="f-u">Unité de vente *</label><select id="f-u" name="unite">${Object.entries(LIBELLE_UNITE).map(([k, v]) => `<option value="${k}" ${p?.unite === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="champ"><label for="f-fo">Fournisseur habituel</label><select id="f-fo" name="fournisseur_id"><option value="">—</option>${fo}</select></div></div>
      <div class="ligne"><div class="champ"><label for="f-pa">Prix d'achat (FCFA) *</label><input id="f-pa" name="prix_achat" required inputmode="numeric" value="${p?.prix_achat ?? ''}"></div><div class="champ"><label for="f-pv">Prix de vente (FCFA) *</label><input id="f-pv" name="prix_vente" required inputmode="numeric" value="${p?.prix_vente ?? ''}"></div></div>
      <div class="ligne"><div class="champ"><label for="f-min">Stock minimum</label><input id="f-min" name="stock_min" inputmode="decimal" value="${p?.stock_min ?? 0}"></div>${p ? '' : '<div class="champ"><label for="f-si">Quantité en stock au départ</label><input id="f-si" name="stock_initial" inputmode="decimal" value="0"></div>'}<div class="champ"><label for="f-per">Date de péremption</label><input id="f-per" name="date_peremption" type="date" value="${p?.date_peremption?.slice(0, 10) || ''}"></div></div>
      <details class="champ"><summary>Conditionnement (carton de N bouteilles…)</summary><div class="ligne mt"><div class="champ"><label for="f-qc">Unités de base par ${'unité de vente'}</label><input id="f-qc" name="qte_par_conditionnement" inputmode="decimal" value="${p?.qte_par_conditionnement ?? ''}" placeholder="ex. 24"></div><div class="champ"><label for="f-ub">Unité de base</label><input id="f-ub" name="unite_base" value="${esc(p?.unite_base)}" placeholder="bouteille"></div></div><p class="mini">Un carton de 24 bouteilles reste un produit distinct de la bouteille vendue seule : créez les deux produits et achetez au carton.</p></details>
      <label><input type="checkbox" name="autoriser_stock_negatif" style="width:auto;min-height:0" ${p?.autoriser_stock_negatif ? 'checked' : ''}> Autoriser la vente sans stock suffisant (stock négatif)</label></form>`,
      boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, fermer) => {
        const f = $('#fp', ov); if (!f.reportValidity()) return;
        const v = n => f.elements[n].value.trim();
        await ops.sauverProduit({ ...(p ? { id: p.id } : {}), nom: v('nom'), reference: v('reference'), code_barres: v('code_barres') || null, categorie_id: v('categorie_id') || null, fournisseur_id: v('fournisseur_id') || null, unite: v('unite'),
          prix_achat: entier(v('prix_achat')), prix_vente: entier(v('prix_vente')), stock_min: v('stock_min') ? decimal(v('stock_min')) : 0, date_peremption: v('date_peremption') || null,
          qte_par_conditionnement: v('qte_par_conditionnement') ? decimal(v('qte_par_conditionnement')) : null, unite_base: v('unite_base') || null, autoriser_stock_negatif: f.elements.autoriser_stock_negatif.checked,
          ...(p ? {} : { stock_initial: v('stock_initial') ? decimal(v('stock_initial')) : 0 }) });
        fermer(); toast('Produit enregistré', 'ok'); charger(); } }] });
  }
  $('#q', vue).oninput = dessiner; $('#fc', vue).onchange = dessiner;
  $('#nouveau', vue)?.addEventListener('click', () => formulaire());
  $('#cats', vue)?.addEventListener('click', async () => { const n = await saisie('Nouvelle catégorie', 'Nom de la catégorie'); if (n) { try { await ops.sauverCategorie({ nom: n }); toast('Catégorie ajoutée', 'ok'); charger(); } catch (e) { erreurUtilisateur(e); } } });
  $('#exp', vue).onclick = () => telechargerTexte('produits.csv', versCSV(produits, [{ titre: 'reference', cle: 'reference' }, { titre: 'nom', cle: 'nom' }, { titre: 'code_barres', cle: 'code_barres' }, { titre: 'categorie', val: p => cats.get(p.categorie_id) || '' }, { titre: 'unite', cle: 'unite' }, { titre: 'prix_achat', cle: 'prix_achat' }, { titre: 'prix_vente', cle: 'prix_vente' }, { titre: 'stock', val: p => stocks.get(p.id) || 0 }, { titre: 'stock_min', cle: 'stock_min' }, { titre: 'date_peremption', cle: 'date_peremption' }]));
  $('#imp', vue)?.addEventListener('click', () => $('#fichier', vue).click());
  $('#fichier', vue).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    try {
      const lignes = lireCSV(await f.text()); if (!lignes.length) throw new Error('Fichier vide');
      let ok = 0; const erreurs = [];
      for (const [i, l] of lignes.entries()) {
        try {
          let cat = null; if (l.categorie) { const ex = [...cats].find(([, n]) => n.toLowerCase() === l.categorie.toLowerCase()); cat = ex ? ex[0] : (await ops.sauverCategorie({ nom: l.categorie })).id; if (!ex) cats.set(cat, l.categorie); }
          const exist = (await db.produits.toArray()).find(p => !p.supprime_le && p.reference.toLowerCase() === (l.reference || '').toLowerCase());
          await ops.sauverProduit({ ...(exist ? { ...exist } : {}), reference: l.reference, nom: l.nom, code_barres: l.code_barres || null, categorie_id: cat, unite: l.unite || 'unite', prix_achat: entier(l.prix_achat || 0), prix_vente: entier(l.prix_vente || 0), stock_min: l.stock_min ? decimal(l.stock_min) : 0, date_peremption: l.date_peremption || null, ...(exist ? {} : { stock_initial: l.stock ? decimal(l.stock) : 0 }) }); ok++;
        } catch (x) { erreurs.push(`Ligne ${i + 2} : ${x.message}`); }
      }
      modal({ titre: 'Import terminé', corps: `<p><b>${ok}</b> produit(s) importé(s).</p>${erreurs.length ? `<div class="alerte err">${erreurs.length} ligne(s) ignorée(s) :<br>${esc(erreurs.slice(0, 15).join('\n')).replace(/\n/g, '<br>')}</div>` : ''}<p class="mini">Colonnes attendues : reference, nom, code_barres, categorie, unite, prix_achat, prix_vente, stock, stock_min, date_peremption.</p>`, boutons: [{ texte: 'OK', classe: 'p' }] });
      charger();
    } catch (x) { erreurUtilisateur(x); }
  };
  await charger();
}
