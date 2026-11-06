import { tableauDeBord } from '../services/rapports.js';
import { resume } from '../sync/sync.js';
import { supabase } from '../services/cloud.js';
import { $, esc } from '../ui.js';
import { fcfa, qte, dateHeureFR } from '../utils/format.js';

const kpi = (t, v, note = '') => `<div class="kpi"><small>${t}</small><b>${v}</b>${note ? `<span class="note">${note}</span>` : ''}</div>`;

export async function afficher(vue) {
  const [d, s] = await Promise.all([tableauDeBord(), resume()]);
  const bloc = (titre, c) => `<div class="carte"><h3>${titre}</h3><div class="grille g3">
    ${kpi('Chiffre d\'affaires', fcfa(c.ca), `${c.nb_ventes} vente(s)`)}${kpi('Marge brute estimée', fcfa(c.marge_brute), 'CA − coût d\'achat')}${kpi('Dépenses', fcfa(c.depenses))}${kpi('Bénéfice net estimé', fcfa(c.benefice_net_estime), 'Estimation, non comptable')}</div></div>`;
  vue.innerHTML = `${s.conflit ? `<div class="alerte err">${s.conflit} conflit(s) de synchronisation à résoudre (Paramètres → Synchronisation).</div>` : ''}${s.erreur ? `<div class="alerte err">${s.erreur} opération(s) en erreur de synchronisation.</div>` : ''}
  ${d.stock.perimes.length ? `<div class="alerte err">${d.stock.perimes.length} produit(s) périmé(s) : ${esc(d.stock.perimes.slice(0, 4).map(p => p.nom).join(', '))}</div>` : ''}
  ${bloc('Aujourd\'hui', d.jour)}${bloc('Cette semaine', d.semaine)}${bloc('Ce mois', d.mois)}
  <div class="grille g3">${kpi('Créances clients', fcfa(d.creances), 'À encaisser')}${kpi('Dettes fournisseurs', fcfa(d.dettes), 'À payer')}${kpi('Valeur du stock', fcfa(d.stock.valeur), 'Au prix d\'achat')}
  ${kpi('Encaissé aujourd\'hui', fcfa(d.jour.encaisse_ventes), `+ ${fcfa(d.jour.encaisse_remboursements)} de remboursements de crédits`)}</div>
  <div class="grille g2 mt"><div class="carte"><h3>Stock bas ou en rupture (${d.stock.alertes.length})</h3>${d.stock.alertes.length ? `<div class="table-wrap"><table><tbody>${d.stock.alertes.slice(0, 12).map(a => `<tr><td>${esc(a.produit.nom)}</td><td class="n">${qte(a.stock)}</td><td><span class="badge ${a.statut === 'rupture' ? 'err' : 'warn'}">${a.statut === 'rupture' ? 'Rupture' : 'Bas'}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="mini">Aucune alerte.</p>'}</div>
  <div class="carte"><h3>Produits les plus vendus (mois)</h3>${d.top.length ? d.top.map(t => `<div class="flex"><span class="espace">${esc(t.designation)}</span><b>${fcfa(t.ca)}</b></div><div class="barre-graph" style="width:${Math.max(3, Math.round(100 * t.ca / d.top[0].ca))}%"></div>`).join('') : '<p class="mini">Pas encore de ventes.</p>'}</div></div>
  <div class="carte mt"><h3>Données</h3><p class="mini">Synchronisation : ${supabase() ? `${s.en_attente} opération(s) en attente · dernière synchro ${s.derniere_synchro ? dateHeureFR(s.derniere_synchro) : 'jamais'}` : 'mode local (aucun serveur configuré)'}<br>Dernière sauvegarde : ${d.derniere_sauvegarde ? dateHeureFR(d.derniere_sauvegarde) : '<b>jamais</b> — pensez à sauvegarder (Paramètres)'}</p></div>`;
}
