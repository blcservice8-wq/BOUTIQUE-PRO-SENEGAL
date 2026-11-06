import { db } from '../database/db.js';
import * as ops from '../services/ops.js';
import { creances } from '../services/rapports.js';
import { recuPaiement, releveClient } from '../services/documents.js';
import { peut } from '../services/session.js';
import { $, $$, esc, toast, erreurUtilisateur, modal, entier, imprimerHTML } from '../ui.js';
import { fcfa, dateFR, dateHeureFR, LIBELLE_MODE } from '../utils/format.js';

export async function afficher(vue) {
  vue.innerHTML = `<div class="carte"><div class="ligne"><div><label for="q">Recherche</label><input id="q" type="search" placeholder="Nom ou téléphone"></div><div class="fixe flex"><label class="flex" style="margin:0"><input id="deb" type="checkbox" style="width:auto;min-height:0"> Débiteurs seulement</label><button class="btn p" id="nv">+ Client</button></div></div></div><div id="tot"></div><div class="carte"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Téléphone</th><th class="n">Solde dû</th><th></th></tr></thead><tbody id="c"></tbody></table></div></div>`;
  const charger = async () => {
    const cl = (await db.clients.toArray()).filter(c => !c.supprime_le).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const soldes = new Map(await Promise.all(cl.map(async c => [c.id, await ops.soldeClient(c.id)])));
    const dessiner = () => {
      const t = $('#q', vue).value.toLowerCase(), d = $('#deb', vue).checked;
      const l = cl.filter(c => (!d || soldes.get(c.id) > 0) && (!t || c.nom.toLowerCase().includes(t) || (c.telephone || '').includes(t)));
      $('#tot', vue).innerHTML = `<div class="kpi" style="margin-bottom:12px"><small>Total des créances</small><b>${fcfa([...soldes.values()].filter(x => x > 0).reduce((s, x) => s + x, 0))}</b></div>`;
      $('#c', vue).innerHTML = l.map(c => `<tr><td>${esc(c.nom)}</td><td>${esc(c.telephone)}</td><td class="n">${soldes.get(c.id) > 0 ? `<span class="badge warn">${fcfa(soldes.get(c.id))}</span>` : fcfa(0)}</td><td class="flex"><button class="btn s" data-d="${c.id}">Détail</button>${soldes.get(c.id) > 0 ? `<button class="btn s p" data-p="${c.id}">Encaisser</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucun client</td></tr>';
      $$('[data-d]', vue).forEach(b => b.onclick = () => detail(b.dataset.d, charger));
      $$('[data-p]', vue).forEach(b => b.onclick = () => encaisser(b.dataset.p, charger));
    };
    $('#q', vue).oninput = dessiner; $('#deb', vue).onchange = dessiner; dessiner();
  };
  $('#nv', vue).onclick = () => formulaire({}, charger);
  await charger();
}

function formulaire(c, apres) {
  modal({ titre: c.id ? 'Modifier le client' : 'Nouveau client', corps: `<div class="champ"><label for="n">Nom *</label><input id="n" value="${esc(c.nom)}" maxlength="80"></div><div class="champ"><label for="t">Téléphone</label><input id="t" inputmode="tel" value="${esc(c.telephone)}"></div><div class="champ"><label for="a">Adresse</label><input id="a" value="${esc(c.adresse)}"></div>${peut('client_modifier') ? `<div class="champ"><label for="pl">Plafond de crédit (FCFA, facultatif)</label><input id="pl" inputmode="numeric" value="${c.plafond_credit ?? ''}"></div>` : ''}`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { await ops.sauverClient({ ...c, nom: $('#n', ov).value, telephone: $('#t', ov).value, adresse: $('#a', ov).value, ...($('#pl', ov) ? { plafond_credit: $('#pl', ov).value ? entier($('#pl', ov).value) : null } : {}) }); f(); toast('Client enregistré', 'ok'); apres(); } }] });
}

async function encaisser(id, apres) {
  const c = await db.clients.get(id), solde = await ops.soldeClient(id);
  modal({ titre: `Remboursement · ${c.nom}`, corps: `<p>Solde dû : <b>${fcfa(solde)}</b></p><div class="ligne"><div class="champ"><label for="m">Montant reçu (FCFA)</label><input id="m" inputmode="numeric" value="${solde}"></div><div class="champ"><label for="mo">Mode</label><select id="mo">${['especes', 'wave', 'orange_money', 'autre_mobile'].map(m => `<option value="${m}">${LIBELLE_MODE[m]}</option>`).join('')}</select></div></div><p class="mini">Le paiement est imputé sur les crédits les plus anciens. Les espèces entrent en caisse comme un encaissement distinct des ventes.</p>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', ferme: false, action: async (ov, f) => { const m = entier($('#m', ov).value), mo = $('#mo', ov).value; const r = await ops.rembourserClient(id, m, mo); f(); toast(`Paiement enregistré. Reste dû : ${fcfa(r.solde_restant)}`, 'ok'); apres();
      modal({ titre: 'Reçu', corps: '<p>Imprimer le reçu de paiement ?</p>', boutons: [{ texte: 'Non' }, { texte: '🖨 Imprimer', classe: 'p', action: async () => imprimerHTML(await recuPaiement(id, m, mo, r.solde_restant), 'Reçu', '76mm') }] }); } }] });
}

async function detail(id, apres) {
  const c = await db.clients.get(id), solde = await ops.soldeClient(id);
  const ventes = (await db.ventes.where('client_id').equals(id).toArray()).sort((a, b) => b.vendu_le.localeCompare(a.vendu_le));
  const remb = (await db.remboursements_clients.where('client_id').equals(id).toArray()).sort((a, b) => b.rembourse_le.localeCompare(a.rembourse_le));
  const credits = (await db.credits_clients.where('client_id').equals(id).toArray()).filter(x => x.statut === 'ouvert' && x.echeance);
  modal({ titre: c.nom, corps: `<p>${esc(c.telephone || '')} ${c.adresse ? '· ' + esc(c.adresse) : ''}</p><div class="kpi"><small>Solde restant dû</small><b>${fcfa(solde)}</b></div>${credits.length ? `<h3 class="mt">Échéances</h3>${credits.map(x => `<div>${dateFR(x.echeance)} — ${fcfa(x.montant_initial)} ${Date.parse(x.echeance) < Date.now() ? '<span class="badge err">En retard</span>' : ''}</div>`).join('')}` : ''}
    <h3 class="mt">Achats</h3><div class="table-wrap"><table><tbody>${ventes.slice(0, 30).map(v => `<tr><td>${esc(v.numero)}</td><td>${dateFR(v.vendu_le)}</td><td class="n">${fcfa(v.total)}</td><td class="n">${v.reste_a_payer ? 'crédit ' + fcfa(v.reste_a_payer) : ''}</td></tr>`).join('') || '<tr><td class="vide">Aucun achat</td></tr>'}</tbody></table></div>
    <h3 class="mt">Remboursements</h3><div class="table-wrap"><table><tbody>${remb.map(r => `<tr><td>${dateHeureFR(r.rembourse_le)}</td><td>${LIBELLE_MODE[r.mode]}</td><td class="n">${fcfa(r.montant)}</td></tr>`).join('') || '<tr><td class="vide">Aucun</td></tr>'}</tbody></table></div>`,
    boutons: [{ texte: 'Modifier', action: () => formulaire(c, apres) }, { texte: '🖨 Relevé de compte', action: async () => { imprimerHTML(await releveClient(id), 'Relevé', '190mm'); return false; }, ferme: false }, { texte: 'Fermer', classe: 'p' }] });
}
