import { db, getMeta, setMeta } from './database/db.js';
import { CONFIG, cloudConfigure, enregistrerConfigDistante } from './config.js';
import { chargerProfil, profil, peut, LIBELLE_ROLE, creerProfilLocal, aUnPin, verifierPin, appareil } from './services/session.js';
import { initialiserCloud, activerSync, connexion, inscription, mesBoutiques, creerBoutiqueDistante, choisirBoutique, deconnexion, supabase } from './services/cloud.js';
import { surChangement, lireEtat, demarrerSyncAuto, synchroniser, resume } from './sync/sync.js';
import { $, $$, esc, toast, erreurUtilisateur, agir, modal } from './ui.js';

const ROUTES = [
  { id: 'accueil', titre: 'Tableau de bord', icone: '📊', droit: 'rapports', module: './modules/dashboard.js' },
  { id: 'vente', titre: 'Vente', icone: '🛒', droit: 'vente', module: './modules/ventes.js' },
  { id: 'produits', titre: 'Produits', icone: '📦', droit: 'vente', module: './modules/produits.js' },
  { id: 'stock', titre: 'Stock', icone: '🏷️', droit: 'stock_ajuster', module: './modules/stock.js' },
  { id: 'achats', titre: 'Achats', icone: '🚚', droit: 'achat', module: './modules/achats.js' },
  { id: 'clients', titre: 'Clients & crédits', icone: '👥', droit: 'vente', module: './modules/clients.js' },
  { id: 'caisse', titre: 'Caisse & dépenses', icone: '💵', droit: 'caisse_ouvrir', module: './modules/caisse.js' },
  { id: 'rapports', titre: 'Rapports', icone: '📈', droit: 'rapports', module: './modules/rapports.js' },
  { id: 'parametres', titre: 'Paramètres', icone: '⚙️', droit: null, module: './modules/parametres.js' },
];
const LIBELLE_ETAT = { local: 'Local', en_ligne: 'En ligne', hors_ligne: 'Hors connexion', en_cours: 'Synchronisation…', ok: 'Synchronisé', erreur: 'Erreur de synchro' };

let invite = null, verrouille = false, derniereActivite = Date.now();

// ---------- Démarrage ----------
async function demarrer() {
  appliquerTheme(await getMeta('theme', 'auto'));
  enregistrerServiceWorker();
  initialiserCloud();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invite = e; const b = $('#btn-install'); if (b) b.hidden = false; });
  await chargerProfil();
  $('#splash').hidden = true;
  if (!profil()) return ecranAccueil();
  if (profil().mode === 'cloud') { if (!supabase()) toast('Mode cloud indisponible (hors connexion ou non configuré) : travail en local', ''); else activerSync(); }
  if (await aUnPin()) return verrouiller(true);
  ouvrirApplication();
}

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https:|^http:\/\/localhost|^http:\/\/127\./.test(location.href)) return;
  navigator.serviceWorker.register('service-worker.js').then(reg => {
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', function () {
      if (this.state === 'installed' && navigator.serviceWorker.controller) toast('Mise à jour installée : elle sera active au prochain démarrage', 'ok');
    }));
  }).catch(e => console.warn('Service worker non enregistré', e));
}

export function appliquerTheme(t) {
  const r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#115e59' : '#0f766e');
}

// ---------- Écran d'accueil / connexion ----------
function ecranAccueil(erreur = '') {
  $('#app').hidden = true;
  const racine = $('#modal-racine'); racine.innerHTML = '';
  const cloud = cloudConfigure() && !!supabase();
  document.body.insertAdjacentHTML('beforeend', '<div class="centre" id="accueil"></div>');
  const el = $('#accueil');
  el.innerHTML = `<div class="carte"><div style="text-align:center"><img src="assets/icons/icon-192.png" width="84" height="84" alt=""></div>
    <h2>Boutique Pro Sénégal</h2><p class="mini" style="text-align:center">Gestion de boutique, utilisable sans Internet.</p>
    ${erreur ? `<div class="alerte err">${esc(erreur)}</div>` : ''}
    <h3>Démarrer sur cet appareil</h3>
    <form id="f-local"><div class="champ"><label for="nb">Nom de la boutique</label><input id="nb" name="nom" required maxlength="80" placeholder="Ex. Boutique Ndiaye"></div>
    <button class="btn p gros" type="submit">Commencer (sans compte)</button></form>
    <p class="mini">Les données restent sur cet appareil. Vous pourrez activer la synchronisation plus tard.</p></div>
    <div class="carte"><h3>Compte en ligne ${cloud ? '' : '<span class="badge warn">non configuré</span>'}</h3>
    ${cloud ? `<form id="f-cloud"><div class="champ"><label for="em">E-mail</label><input id="em" name="email" type="email" autocomplete="username" required></div>
      <div class="champ"><label for="mp">Mot de passe</label><input id="mp" name="mdp" type="password" autocomplete="current-password" minlength="6" required></div>
      <div class="flex"><button class="btn p" data-m="connexion" type="submit">Se connecter</button><button class="btn" data-m="inscription" type="submit">Créer un compte</button></div></form>`
      : `<p class="mini">Pour utiliser les comptes, plusieurs appareils et les sauvegardes en ligne, renseignez votre projet Supabase (voir le guide).</p>`}
    <button class="btn s mt" id="cfg">Configurer le serveur distant</button></div>`;
  $('#f-local').onsubmit = async e => { e.preventDefault(); try { await creerProfilLocal(e.target.nom.value.trim()); el.remove(); ouvrirApplication(); } catch (x) { erreurUtilisateur(x); } };
  $('#cfg').onclick = () => configurerServeur();
  const fc = $('#f-cloud');
  if (fc) fc.onsubmit = async e => {
    e.preventDefault(); const mode = e.submitter?.dataset.m, btn = e.submitter; btn.disabled = true;
    try {
      const user = mode === 'inscription' ? await inscription(fc.email.value, fc.mdp.value, fc.email.value.split('@')[0]) : await connexion(fc.email.value, fc.mdp.value);
      await choisirOuCreerBoutique(user, el);
    } catch (x) { erreurUtilisateur(x); } finally { btn.disabled = false; }
  };
}

async function choisirOuCreerBoutique(user, el) {
  const boutiques = await mesBoutiques();
  el.innerHTML = `<div class="carte"><h2>Votre boutique</h2>${boutiques.length ? `<h3>Boutiques existantes</h3>${boutiques.map(b => `<button class="btn gros mt" data-b="${esc(b.id)}">${esc(b.nom)} · ${esc(b.role)}</button>`).join('')}` : '<p>Aucune boutique pour ce compte.</p>'}
    <h3 class="mt">Nouvelle boutique</h3><form id="f-nb"><div class="champ"><input name="nom" required placeholder="Nom de la boutique" maxlength="80"></div><button class="btn p gros" type="submit">Créer la boutique</button></form>
    <button class="btn s mt" id="out">Se déconnecter</button></div>`;
  $$('[data-b]', el).forEach(b => b.onclick = agir(b, async () => { await choisirBoutique(user, boutiques.find(x => x.id === b.dataset.b)); el.remove(); ouvrirApplication(); }));
  $('#f-nb').onsubmit = async e => { e.preventDefault(); const btn = e.submitter; btn.disabled = true; try {
    const id = await creerBoutiqueDistante(e.target.nom.value.trim());
    await choisirBoutique(user, { id, nom: e.target.nom.value.trim(), role: 'proprietaire' }); el.remove(); ouvrirApplication(); } catch (x) { erreurUtilisateur(x); } finally { btn.disabled = false; } };
  $('#out').onclick = async () => { await deconnexion(); el.remove(); ecranAccueil(); };
}

export function configurerServeur() {
  modal({ titre: 'Serveur distant (Supabase)', corps: `<p class="mini">Collez l'URL du projet et la clé <b>publique « anon »</b>. Ne collez jamais la clé « service_role ».</p>
    <div class="champ"><label for="su">URL du projet</label><input id="su" placeholder="https://xxxx.supabase.co" value="${esc(CONFIG.SUPABASE_URL)}"></div>
    <div class="champ"><label for="sk">Clé publique (anon)</label><input id="sk" value="${esc(CONFIG.SUPABASE_ANON_KEY)}"></div>`,
    boutons: [{ texte: 'Annuler' }, { texte: 'Enregistrer', classe: 'p', action: ov => {
      const u = $('#su', ov).value.trim(), k = $('#sk', ov).value.trim();
      if (u && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(u)) throw new Error('URL invalide');
      if (/service_role|^sb_se[c]ret_/i.test(k) || (k.split('.')[1] && (() => { try { return JSON.parse(atob(k.split('.')[1])).role === 'service_role'; } catch { return false; } })())) throw new Error('Cette clé est une clé secrète (service_role) : ne l\'utilisez jamais ici');
      enregistrerConfigDistante(u, k); toast('Enregistré : rechargement…', 'ok'); setTimeout(() => location.reload(), 800); } }] });
}

// ---------- Verrouillage ----------
export async function verrouiller(initial = false) {
  if (verrouille || !(await aUnPin())) return;
  verrouille = true;
  const v = document.createElement('div'); v.className = 'verrou';
  v.innerHTML = `<form class="carte"><h2>🔒 Session verrouillée</h2><div class="champ"><label for="pin">Code PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div><p class="mini" id="pin-err" style="color:var(--err)"></p><button class="btn p gros" type="submit">Déverrouiller</button><button class="btn s mt" type="button" id="quitter">Changer de compte</button></form>`;
  document.body.appendChild(v); $('#pin', v).focus();
  let essais = 0;
  v.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    if (await verifierPin($('#pin', v).value)) { verrouille = false; v.remove(); derniereActivite = Date.now(); if (initial) ouvrirApplication(); }
    else { essais++; $('#pin-err', v).textContent = essais >= 5 ? 'Trop d\'essais : patientez 30 secondes' : 'PIN incorrect'; $('#pin', v).value = ''; if (essais >= 5) { $('button[type=submit]', v).disabled = true; setTimeout(() => { essais = 0; $('button[type=submit]', v).disabled = false; $('#pin-err', v).textContent = ''; }, 30000); } }
  };
  $('#quitter', v).onclick = async () => { if (confirm('Se déconnecter ? Les opérations non synchronisées restent sur cet appareil.')) { await deconnexion(); location.reload(); } };
}

// ---------- Coque ----------
function ouvrirApplication() {
  $('#app').hidden = false;
  construireNav();
  surChangement(majIndicateur); majIndicateur(lireEtat());
  $('#btn-menu').onclick = () => $('#nav').classList.toggle('ouvert');
  $('#indicateur-sync').onclick = async () => { const r = await resume(); toast(`${r.en_attente} en attente · ${r.erreur} en erreur · ${r.conflit} conflit(s)`); if (supabase()) synchroniser({ manuel: true }); else location.hash = '#/parametres'; };
  $('#btn-install').onclick = async () => { if (invite) { invite.prompt(); await invite.userChoice; invite = null; $('#btn-install').hidden = true; } };
  if (invite) $('#btn-install').hidden = false;
  window.addEventListener('hashchange', naviguer);
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { derniereActivite = Date.now(); }, { passive: true }));
  setInterval(async () => { if (!verrouille && Date.now() - derniereActivite > CONFIG.VERROU_INACTIVITE_MIN * 60000) verrouiller(); }, 15000);
  if (supabase() && profil().mode === 'cloud') demarrerSyncAuto();
  if (!location.hash) location.hash = peut('rapports') ? '#/accueil' : '#/vente';
  naviguer();
}

function construireNav() {
  const p = profil();
  $('#nav').innerHTML = ROUTES.filter(r => !r.droit || peut(r.droit)).map(r => `<a href="#/${r.id}" data-r="${r.id}"><span aria-hidden="true">${r.icone}</span>${r.titre}</a>`).join('') +
    `<div class="pied"><b>${esc(p.boutique_nom || '')}</b><br>${esc(p.nom || '')} · ${esc(LIBELLE_ROLE[p.role] || p.role)}<br><span class="mini" id="info-app"></span></div>`;
  appareil().then(a => { const e = $('#info-app'); if (e) e.textContent = `Appareil ${a.slice(0, 2)}`; });
  $('#nav').onclick = e => { if (e.target.closest('a')) $('#nav').classList.remove('ouvert'); };
}

function majIndicateur({ etat, detail }) {
  const b = $('#indicateur-sync'); if (!b) return;
  b.dataset.etat = etat; $('#txt-sync').textContent = LIBELLE_ETAT[etat] || etat; b.title = detail || LIBELLE_ETAT[etat];
}

let vueCourante = 0;
async function naviguer() {
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'accueil';
  let route = ROUTES.find(r => r.id === id);
  if (!route || (route.droit && !peut(route.droit))) route = ROUTES.find(r => !r.droit || peut(r.droit));
  $$('#nav a').forEach(a => a.removeAttribute('aria-current')); $(`#nav a[data-r=${route.id}]`)?.setAttribute('aria-current', 'page');
  $('#titre-page').textContent = route.titre;
  const vue = $('#vue'), mon = ++vueCourante;
  vue.innerHTML = '<div class="chargement">Chargement…</div>';
  try {
    const m = await import(route.module);
    if (mon !== vueCourante) return;
    vue.innerHTML = ''; await m.afficher(vue); vue.focus({ preventScroll: true }); window.scrollTo(0, 0);
  } catch (e) { console.error(e); if (mon === vueCourante) vue.innerHTML = `<div class="alerte err">Erreur d'affichage : ${esc(e.message)}</div>`; }
}
export const rafraichir = () => naviguer();

demarrer().catch(e => { console.error(e); $('#splash').innerHTML = `<p>Erreur au démarrage : ${esc(e.message)}</p>`; });
