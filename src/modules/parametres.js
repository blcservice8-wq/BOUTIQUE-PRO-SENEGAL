import { db, getMeta, setMeta } from '../database/db.js';
import { CONFIG, cloudConfigure } from '../config.js';
import { profil, peut, definirPin, supprimerPin, aUnPin, LIBELLE_ROLE, appareil } from '../services/session.js';
import { exporterSauvegarde, restaurerSauvegarde } from '../services/backup.js';
import { supabase, deconnexion, membres, ajouterMembre, creerBoutiqueDistante, mesBoutiques, activerSync } from '../services/cloud.js';
import { operationsEnAttente, reessayer, abandonner, resoudreConflit, synchroniser, resume, demarrerSyncAuto } from '../sync/sync.js';
import { telechargerTexte } from '../utils/csv.js';
import { appliquerTheme, configurerServeur, verrouiller } from '../app.js';
import { $, $$, esc, toast, erreurUtilisateur, agir, modal, confirmer } from '../ui.js';
import { dateHeureFR, fcfa } from '../utils/format.js';

export async function afficher(vue) {
  const p = profil(), b = (await getMeta('boutique')) || {}, theme = await getMeta('theme', 'auto'), pin = await aUnPin(), s = await resume();
  const proprio = p.role === 'proprietaire', cloud = !!supabase() && p.mode === 'cloud';
  vue.innerHTML = `
  <div class="carte"><h3>Boutique</h3><form id="fb"><div class="ligne"><div class="champ"><label for="bn">Nom</label><input id="bn" name="nom" value="${esc(b.nom)}" ${proprio ? '' : 'disabled'}></div><div class="champ"><label for="bt">Téléphone</label><input id="bt" name="telephone" value="${esc(b.telephone)}" ${proprio ? '' : 'disabled'}></div></div>
    <div class="champ"><label for="ba">Adresse</label><input id="ba" name="adresse" value="${esc(b.adresse)}" ${proprio ? '' : 'disabled'}></div><div class="champ"><label for="bp">Message en bas du ticket</label><input id="bp" name="pied_ticket" value="${esc(b.pied_ticket)}" ${proprio ? '' : 'disabled'}></div>
    <div class="champ"><label for="bl">Logo (image, facultatif)</label><input id="bl" type="file" accept="image/*" ${proprio ? '' : 'disabled'}>${b.logo ? `<img src="${b.logo}" alt="Logo" style="max-height:60px;margin-top:6px">` : ''}</div>${proprio ? '<button class="btn p" type="submit">Enregistrer</button>' : '<p class="mini">Réservé au propriétaire.</p>'}</form></div>
  <div class="carte"><h3>Affichage et sécurité</h3><div class="ligne"><div class="champ"><label for="th">Thème</label><select id="th">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, v]) => `<option value="${k}" ${theme === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="fixe flex"><button class="btn" id="pin">${pin ? 'Changer le PIN' : 'Définir un PIN de verrouillage'}</button>${pin ? '<button class="btn" id="nopin">Retirer le PIN</button><button class="btn" id="lock">Verrouiller</button>' : ''}</div></div>
    <p class="mini">Le PIN verrouille l'écran après ${CONFIG.VERROU_INACTIVITE_MIN} min d'inactivité. Il ne chiffre pas les données stockées sur l'appareil : protégez aussi l'appareil lui-même.</p></div>
  <div class="carte"><h3>Synchronisation</h3><p>Mode : <b>${p.mode === 'cloud' ? 'compte en ligne' : 'local (sans serveur)'}</b>${cloudConfigure() ? '' : ' · serveur non configuré'}<br>${s.en_attente} en attente · ${s.erreur} en erreur · ${s.conflit} conflit(s) · dernière synchro : ${s.derniere_synchro ? dateHeureFR(s.derniere_synchro) : 'jamais'}</p>
    <div class="flex">${cloud ? '<button class="btn p" id="sync">Synchroniser maintenant</button>' : ''}<button class="btn" id="srv">Configurer le serveur distant</button>${!cloud && cloudConfigure() && supabase() && proprio ? '<button class="btn" id="activer">Activer la synchronisation de cette boutique</button>' : ''}</div><div id="file" class="mt"></div></div>
  ${cloud && proprio ? '<div class="carte"><h3>Utilisateurs de la boutique</h3><div id="mb"></div></div>' : ''}
  <div class="carte"><h3>Sauvegarde et restauration</h3><p class="mini">Exportez régulièrement une copie complète de vos données (fichier à conserver hors de l'appareil : clé USB, e-mail…).</p><div class="flex"><button class="btn p" id="sauv">Exporter une sauvegarde</button>${peut('sauvegarde') ? '<button class="btn" id="rest">Restaurer une sauvegarde</button>' : ''}</div><input id="fr" type="file" accept=".json,application/json" hidden></div>
  <div class="carte"><h3>Installer l'application</h3><details><summary>Android (Chrome)</summary><p>Menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).</p></details><details><summary>iPhone / iPad (Safari uniquement)</summary><p>Bouton Partager <b>⬆︎</b> → « Sur l'écran d'accueil ». Ouvrez l'application depuis l'icône ensuite. Sur iOS, ne la laissez pas inutilisée plusieurs semaines sans synchroniser ni sauvegarder : Safari peut effacer les données d'un site peu utilisé.</p></details><details><summary>Windows / Linux / macOS (Chrome, Edge)</summary><p>Icône « Installer » dans la barre d'adresse, ou bouton « Installer » en haut de l'écran. Safari macOS : Fichier → Ajouter au Dock.</p></details></div>
  <div class="carte"><h3>Compte</h3><p>${esc(p.nom)} · ${esc(LIBELLE_ROLE[p.role])} · appareil ${esc((await appareil()).slice(0, 2))}<br>Boutique : ${esc(p.boutique_nom)}</p><button class="btn d" id="out">${p.mode === 'cloud' ? 'Se déconnecter' : 'Quitter cette boutique locale'}</button></div>
  <p class="mini">Boutique Pro Sénégal v${CONFIG.VERSION_SAUVEGARDE}.0 — PWA. Les paiements Wave / Orange Money sont des enregistrements manuels. La marge affichée est une estimation de gestion, pas un bénéfice comptable.</p>`;

  $('#fb', vue).onsubmit = agir(null, async e => { e.preventDefault(); if (!proprio) return; const f = e.target, nouv = { ...b, nom: f.nom.value.trim(), telephone: f.telephone.value.trim(), adresse: f.adresse.value.trim(), pied_ticket: f.pied_ticket.value.trim() };
    const fic = $('#bl', vue).files[0]; if (fic) { if (fic.size > 300000) throw new Error('Logo trop lourd (300 Ko maximum)'); nouv.logo = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(fic); }); }
    if (!nouv.nom) throw new Error('Le nom est obligatoire'); await setMeta('boutique', nouv); toast('Boutique enregistrée', 'ok'); });
  $('#th', vue).onchange = async e => { await setMeta('theme', e.target.value); appliquerTheme(e.target.value); };
  $('#pin', vue).onclick = () => modal({ titre: 'PIN de verrouillage', corps: '<div class="champ"><label for="np">Nouveau PIN (4 à 8 chiffres)</label><input id="np" type="password" inputmode="numeric" maxlength="8"></div>', boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', action: async ov => { await definirPin($('#np', ov).value); toast('PIN enregistré', 'ok'); afficher(vue); } }] });
  $('#nopin', vue)?.addEventListener('click', async () => { if (await confirmer('Retirer le PIN ?')) { await supprimerPin(); afficher(vue); } });
  $('#lock', vue)?.addEventListener('click', () => verrouiller());
  $('#srv', vue).onclick = configurerServeur;
  $('#sync', vue)?.addEventListener('click', agir($('#sync', vue), async () => { const r = await synchroniser({ manuel: true }); toast(r.erreur ? 'Échec de la synchronisation' : 'Synchronisation terminée', r.erreur ? 'err' : 'ok'); afficher(vue); }));
  $('#activer', vue)?.addEventListener('click', async () => { if (!await confirmer('Envoyer cette boutique et ses données vers votre compte en ligne ? Une connexion est nécessaire.', { texte: 'Activer' })) return; try { await adopterBoutiqueLocale(); toast('Boutique envoyée', 'ok'); afficher(vue); } catch (e) { erreurUtilisateur(e); } });
  $('#sauv', vue).onclick = agir($('#sauv', vue), async () => { const s = await exporterSauvegarde(); telechargerTexte(`sauvegarde-boutique-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(s), 'application/json'); toast('Sauvegarde exportée', 'ok'); });
  $('#rest', vue)?.addEventListener('click', () => $('#fr', vue).click());
  $('#fr', vue).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const s = JSON.parse(await f.text());
    if (!await confirmer(`Remplacer TOUTES les données de cet appareil par la sauvegarde du ${dateHeureFR(s.cree_le)} ? Une copie de l'état actuel sera téléchargée avant.`, { danger: true, texte: 'Restaurer' })) return;
    const r = await restaurerSauvegarde(s); telechargerTexte('avant-restauration.json', JSON.stringify(r.sauvegarde_avant), 'application/json'); toast('Données restaurées : rechargement…', 'ok'); setTimeout(() => location.reload(), 1200); } catch (x) { erreurUtilisateur(x); } };
  $('#out', vue).onclick = async () => { if (!await confirmer(p.mode === 'cloud' ? 'Se déconnecter ? Les opérations non synchronisées restent sur cet appareil.' : 'Quitter ? Les données locales restent sur cet appareil mais l\'accès sera réinitialisé. Exportez d\'abord une sauvegarde.', { danger: true })) return; if (p.mode === 'cloud') await deconnexion(); await db.meta.delete('profil'); location.hash = ''; location.reload(); };
  dessinerFile($('#file', vue), vue); if (cloud && proprio) dessinerMembres($('#mb', vue), p);
}

async function adopterBoutiqueLocale() {
  const p = profil(), b = await getMeta('boutique'); const { data } = await supabase().auth.getUser(); if (!data?.user) throw new Error('Connectez-vous d\'abord (Se déconnecter puis créer/choisir une boutique en ligne)');
  await creerBoutiqueDistante(b.nom, p.boutique_id);
  const { enregistrerProfil } = await import('../services/session.js');
  await enregistrerProfil({ ...p, mode: 'cloud', user_id: data.user.id, email: data.user.email });
  // les opérations locales déjà en file portent l'ancien identifiant d'utilisateur : le serveur utilise auth.uid(), pas ce champ.
  activerSync(); demarrerSyncAuto(); await synchroniser({ manuel: true });
}

async function dessinerFile(z, vue) {
  const ops = (await operationsEnAttente()).filter(o => o.statut !== 'en_attente' && o.statut !== 'envoi');
  const alertes = (await db.alertes.toArray()).filter(a => !a.lu);
  z.innerHTML = (alertes.length ? `<div class="alerte">${alertes.length} alerte(s) de stock négatif suite à des ventes hors ligne simultanées. Régularisez par un inventaire. <button class="btn s" id="lu">Marquer comme lues</button></div>` : '') +
    (ops.length ? `<h3>À traiter</h3>${ops.map(o => `<div class="carte" style="margin-bottom:8px"><b>${esc(o.type)}</b> <span class="badge ${o.statut === 'conflit' ? 'err' : 'warn'}">${o.statut}</span><br><span class="mini">${esc(o.derniere_erreur || '')} · ${o.tentatives || 0} tentative(s)</span>
      <div class="flex mt">${o.statut === 'conflit' ? `<button class="btn s p" data-l="${o.op_id}">Garder ma version</button><button class="btn s" data-s="${o.op_id}">Garder la version du serveur</button>` : `<button class="btn s p" data-r="${o.op_id}">Réessayer</button>`}<button class="btn s d" data-a="${o.op_id}">Abandonner</button></div></div>`).join('')}` : '');
  $('#lu', z)?.addEventListener('click', async () => { await db.alertes.toCollection().modify({ lu: 1 }); dessinerFile(z, vue); });
  const act = (sel, fn) => $$(sel, z).forEach(b => b.onclick = agir(b, async () => { await fn(b); afficher(vue); }));
  act('[data-r]', b => reessayer(b.dataset.r)); act('[data-l]', b => resoudreConflit(b.dataset.l, 'garder_local')); act('[data-s]', b => resoudreConflit(b.dataset.s, 'garder_serveur'));
  $$('[data-a]', z).forEach(b => b.onclick = async () => { if (await confirmer('Abandonner cette opération ? Elle ne sera jamais envoyée au serveur.', { danger: true, texte: 'Abandonner' })) { await abandonner(b.dataset.a); afficher(vue); } });
}

async function dessinerMembres(z, p) {
  try {
    const l = await membres(p.boutique_id);
    z.innerHTML = `<table><tbody>${l.map(m => `<tr><td>${esc(m.email)}</td><td>${esc(LIBELLE_ROLE[m.role])}</td><td>${m.actif ? '' : '<span class="badge err">désactivé</span>'}</td></tr>`).join('')}</tbody></table>
      <form id="fm" class="ligne mt"><div><label for="me">E-mail du compte existant</label><input id="me" type="email" required></div><div><label for="mr">Rôle</label><select id="mr"><option value="caissier">Caissier</option><option value="gerant">Gérant</option><option value="proprietaire">Propriétaire</option></select></div><div class="fixe"><button class="btn p" type="submit">Ajouter / modifier</button></div></form><p class="mini">La personne doit d'abord créer son compte depuis l'écran de connexion.</p>`;
    $('#fm', z).onsubmit = async e => { e.preventDefault(); try { await ajouterMembre(p.boutique_id, $('#me', z).value, $('#mr', z).value); toast('Utilisateur ajouté', 'ok'); dessinerMembres(z, p); } catch (x) { erreurUtilisateur(x); } };
  } catch (e) { z.innerHTML = `<p class="mini">Indisponible hors connexion (${esc(e.message)})</p>`; }
}
