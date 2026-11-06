import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { rapportCaisseHTML } from '../services/documents.js';
import { $, $$, esc, toast, erreurUtilisateur, modal, saisie, confirmer, entier, imprimerHTML } from '../ui.js';
import { fcfa, dateHeureFR } from '../utils/format.js';
import { peut } from '../services/session.js';

const CATS = { transport: 'Transport', electricite: 'Électricité', eau: 'Eau', loyer: 'Loyer', telephone: 'Téléphone', reparation: 'Réparation', salaires: 'Salaires', autres: 'Autres dépenses' };
const LIB = { fonds_initial: 'Fonds initial', vente_especes: 'Vente (espèces)', remboursement_credit: 'Remboursement de crédit', depense: 'Dépense', retrait: 'Retrait', apport: 'Apport', paiement_fournisseur: 'Paiement fournisseur', annulation_vente: 'Annulation de vente' };

export async function afficher(vue) {
  const c = await ops.caisseOuverte();
  if (!c) {
    const anciennes = (await db.caisses.toArray()).filter(x => x.statut === 'fermee').sort((a, b) => b.ouverte_le.localeCompare(a.ouverte_le)).slice(0, 10);
    vue.innerHTML = `<div class="carte"><h2>Caisse fermée</h2><div class="champ"><label for="fi">Fonds initial (FCFA)</label><input id="fi" inputmode="numeric" value="0"></div><button class="btn p gros" id="ouvrir">Ouvrir la caisse</button></div>
      <div class="carte"><h3>Dernières clôtures</h3><div class="table-wrap"><table><thead><tr><th>Ouverture</th><th class="n">Théorique</th><th class="n">Compté</th><th class="n">Écart</th><th></th></tr></thead><tbody>${anciennes.map(x => `<tr><td>${dateHeureFR(x.ouverte_le)}</td><td class="n">${fcfa(x.solde_theorique)}</td><td class="n">${fcfa(x.montant_compte)}</td><td class="n"><span class="badge ${x.ecart ? 'warn' : 'ok'}">${fcfa(x.ecart)}</span></td><td><button class="btn s" data-p="${x.id}">🖨</button></td></tr>`).join('') || '<tr><td colspan="5" class="vide">Aucune clôture</td></tr>'}</tbody></table></div></div>`;
    $('#ouvrir', vue).onclick = async e => { e.target.disabled = true; try { await ops.ouvrirCaisse(entier($('#fi', vue).value || 0)); toast('Caisse ouverte', 'ok'); afficher(vue); } catch (x) { erreurUtilisateur(x); e.target.disabled = false; } };
    $$('[data-p]', vue).forEach(b => b.onclick = async () => imprimerHTML(await rapportCaisseHTML(b.dataset.p), 'Rapport de caisse', '76mm'));
    return;
  }
  const mv = (await db.mouvements_caisse.where('caisse_id').equals(c.id).toArray()).sort((a, b) => b.survenu_le.localeCompare(a.survenu_le));
  const solde = await ops.soldeTheoriqueCaisse(c.id);
  const entrees = mv.filter(m => m.sens > 0).reduce((s, m) => s + m.montant, 0), sorties = mv.filter(m => m.sens < 0).reduce((s, m) => s + m.montant, 0);
  vue.innerHTML = `<div class="grille g3"><div class="kpi"><small>Solde théorique en espèces</small><b>${fcfa(solde)}</b></div><div class="kpi"><small>Entrées</small><b>${fcfa(entrees)}</b></div><div class="kpi"><small>Sorties</small><b>${fcfa(sorties)}</b></div></div>
  <div class="flex mt">${peut('depense') ? '<button class="btn p" id="dep">+ Dépense</button><button class="btn" id="ret">Retrait</button>' : ''}<button class="btn" id="rap">🖨 Rapport</button><button class="btn d" id="clo">Clôturer la caisse</button></div>
  <div class="carte mt"><p class="mini">Les ventes à crédit et les paiements Wave / Orange Money ne sont pas des espèces : ils n'apparaissent pas ici.</p><div class="table-wrap"><table><thead><tr><th>Heure</th><th>Opération</th><th>Détail</th><th class="n">Montant</th></tr></thead><tbody>${mv.map(m => `<tr><td>${dateHeureFR(m.survenu_le)}</td><td>${LIB[m.type] || m.type}</td><td>${esc(m.libelle)}</td><td class="n" style="color:var(${m.sens > 0 ? '--ok' : '--err'})">${m.sens > 0 ? '+' : '−'}${fcfa(m.montant)}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#dep', vue)?.addEventListener('click', () => modal({ titre: 'Nouvelle dépense', corps: `<div class="ligne"><div class="champ"><label for="dc">Catégorie</label><select id="dc">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="champ"><label for="dm">Montant (FCFA)</label><input id="dm" inputmode="numeric"></div></div><div class="champ"><label for="dd">Description</label><input id="dd" maxlength="120"></div><div class="champ"><label for="dmo">Payée en</label><select id="dmo"><option value="especes">Espèces (sort de la caisse)</option><option value="wave">Wave</option><option value="orange_money">Orange Money</option><option value="autre_mobile">Autre mobile</option></select></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.enregistrerDepense({ categorie: $('#dc', ov).value, montant: entier($('#dm', ov).value), mode: $('#dmo', ov).value, description: $('#dd', ov).value }); f(); toast('Dépense enregistrée', 'ok'); afficher(vue); } }] }));
  $('#ret', vue)?.addEventListener('click', () => modal({ titre: 'Retrait de caisse', corps: `<div class="champ"><label for="rm">Montant (FCFA)</label><input id="rm" inputmode="numeric"></div><div class="champ"><label for="rl">Motif</label><input id="rl" maxlength="120" placeholder="Ex. dépôt en banque"></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.enregistrerRetrait({ montant: entier($('#rm', ov).value), libelle: $('#rl', ov).value }); f(); toast('Retrait enregistré', 'ok'); afficher(vue); } }] }));
  $('#rap', vue).onclick = async () => imprimerHTML(await rapportCaisseHTML(c.id), 'Rapport de caisse', '76mm');
  $('#clo', vue).onclick = () => modal({ titre: 'Clôture de caisse', corps: `<p>Solde théorique : <b>${fcfa(solde)}</b></p><div class="champ"><label for="cm">Argent réellement compté (FCFA)</label><input id="cm" inputmode="numeric"></div><div id="ec"></div>`,
    onMount: ov => $('#cm', ov).addEventListener('input', e => { try { const d = entier(e.target.value) - solde; $('#ec', ov).innerHTML = `<div class="alerte ${d ? '' : 'ok'}">Écart : <b>${d > 0 ? '+' : ''}${fcfa(d)}</b> ${d < 0 ? '(manque)' : d > 0 ? '(excédent)' : '— caisse juste'}</div>`; } catch { $('#ec', ov).innerHTML = ''; } }),
    boutons: [{ texte: 'Annuler' }, { texte: 'Clôturer', classe: 'd', ferme: false, action: async (ov, f) => { if (!$('#cm', ov).value.trim()) throw new Error('Saisissez le montant compté'); const r = await ops.fermerCaisse(entier($('#cm', ov).value)); f(); toast(`Caisse clôturée. Écart : ${fcfa(r.ecart)}`, r.ecart ? '' : 'ok'); imprimerHTML(await rapportCaisseHTML(r.caisse_id), 'Rapport de caisse', '76mm'); afficher(vue); } }] });
}
