// Petits utilitaires d'interface : toasts, modales, formulaires, impression.
import { esc } from './utils/format.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export { esc };

export function toast(message, type = '') {
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: message });
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), type === 'err' ? 6000 : 3000);
}
export const erreurUtilisateur = e => { console.error(e); toast(e?.message || String(e), 'err'); };

// Enveloppe : exécute une action, affiche les erreurs lisibles, empêche le double déclenchement du bouton.
export function agir(btn, fn) {
  return async (ev) => {
    ev?.preventDefault?.();
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { erreurUtilisateur(e); } finally { if (btn?.isConnected) btn.disabled = false; }
  };
}

export function modal({ titre, corps, boutons = [], onMount, large = false }) {
  const racine = $('#modal-racine');
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="modal"><header><h2 style="margin:0">${esc(titre)}</h2><button class="btn s" data-x aria-label="Fermer">✕</button></header><div data-corps>${corps}</div><footer></footer></div>`;
  const fermer = () => { ov.remove(); document.removeEventListener('keydown', echap); };
  const echap = e => { if (e.key === 'Escape') fermer(); };
  document.addEventListener('keydown', echap);
  $('[data-x]', ov).onclick = fermer;
  const pied = $('footer', ov);
  boutons.forEach(b => {
    const el = Object.assign(document.createElement('button'), { className: `btn ${b.classe || ''}`, textContent: b.texte, type: 'button' });
    el.onclick = agir(el, async () => { const r = await b.action?.(ov, fermer); if (b.ferme !== false && r !== false) fermer(); });
    pied.appendChild(el);
  });
  racine.appendChild(ov); onMount?.(ov, fermer);
  const premier = $('input,select,textarea', ov); premier?.focus();
  return { fermer, el: ov };
}

export const confirmer = (message, { texte = 'Confirmer', danger = false } = {}) => new Promise(res => {
  let fait = false;
  const m = modal({ titre: 'Confirmation', corps: `<p>${esc(message)}</p>`, boutons: [
    { texte: 'Annuler', action: () => { fait = true; res(false); } },
    { texte, classe: danger ? 'd' : 'p', action: () => { fait = true; res(true); } }] });
  m.el.addEventListener('click', e => { if (e.target === m.el && !fait) { fait = true; res(false); m.fermer(); } });
  $('[data-x]', m.el).addEventListener('click', () => { if (!fait) { fait = true; res(false); } });
});

export const saisie = (titre, libelle, { type = 'text', valeur = '', note = '' } = {}) => new Promise(res => {
  let fait = false;
  modal({ titre, corps: `<div class="champ"><label for="saisie-v">${esc(libelle)}</label><input id="saisie-v" type="${type}" value="${esc(valeur)}" ${type === 'number' ? 'inputmode="numeric" min="0"' : ''}>${note ? `<p class="mini">${esc(note)}</p>` : ''}</div>`,
    boutons: [{ texte: 'Annuler', action: () => { fait = true; res(null); } }, { texte: 'Valider', classe: 'p', action: ov => { fait = true; res($('#saisie-v', ov).value); } }],
    onMount: (ov, f) => { $('#saisie-v', ov).addEventListener('keydown', e => { if (e.key === 'Enter') { fait = true; res($('#saisie-v', ov).value); f(); } }); } });
});

export const lire = (form, nom) => form.elements[nom]?.value ?? '';
export const entier = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(n)) throw new Error('Nombre invalide'); return Math.round(n); };
export const decimal = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); if (!Number.isFinite(n)) throw new Error('Nombre invalide'); return n; };

export function imprimerHTML(contenu, titre = 'Impression', largeur = '') {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open(); d.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre)}</title><style>
    body{font:13px/1.35 "Courier New",monospace;margin:0;padding:6px;${largeur ? `width:${largeur};` : ''}color:#000}
    h1,h2{margin:4px 0;text-align:center}h1{font-size:16px}h2{font-size:13px}hr{border:0;border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse}td,th{padding:2px 0;vertical-align:top;text-align:left}td.n,th.n{text-align:right}.c{text-align:center}.g{font-weight:bold}.t{font-size:15px}
    @page{margin:6mm}</style></head><body>${contenu}</body></html>`); d.close();
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 3000); } };
  setTimeout(go, 150);
}
