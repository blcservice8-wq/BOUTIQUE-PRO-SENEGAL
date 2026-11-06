// Parcours navigateur réel (Chromium) : installation PWA, vente, mode avion, fermeture/réouverture.
// Lancer : node tests/e2e.mjs   (nécessite Playwright + Chromium)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { demarrer } from '../scripts/serve.mjs';

const serveur = await demarrer(8123), URL = 'http://localhost:8123/index.html';
const navigateur = await chromium.launch();
const ctx = await navigateur.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const erreurs = []; page.on('pageerror', e => erreurs.push(e.message)); page.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
const etapes = []; const ok = (n) => { etapes.push(n); console.log('✓', n); };

try {
  await page.goto(URL); await page.waitForSelector('#f-local');
  await page.fill('#nb', 'Boutique Test'); await page.click('#f-local button[type=submit]');
  await page.waitForSelector('#nav a'); ok('démarrage en mode local');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => navigator.serviceWorker.controller || true);
  const caches = await page.evaluate(async () => (await (await window.caches.open((await window.caches.keys())[0])).keys()).length);
  assert.ok(caches > 30, 'précache'); ok(`service worker actif, ${caches} fichiers en cache`);
  const manifest = await page.evaluate(async () => (await (await fetch('manifest.json')).json()).display); assert.equal(manifest, 'standalone'); ok('manifest valide');

  await page.goto(URL + '#/produits'); await page.waitForSelector('#nouveau');
  await page.click('#nouveau'); await page.fill('#f-nom', 'Riz 50kg'); await page.fill('#f-ref', 'RIZ50'); await page.selectOption('#f-u', 'sac');
  await page.fill('#f-pa', '16000'); await page.fill('#f-pv', '18000'); await page.fill('#f-si', '10');
  await page.click('.modal footer .btn.p'); await page.waitForSelector('text=Riz 50kg'); ok('produit créé');

  await page.goto(URL + '#/caisse'); await page.waitForSelector('#ouvrir'); await page.fill('#fi', '5000'); await page.click('#ouvrir'); await page.waitForSelector('#clo'); ok('caisse ouverte');

  await page.goto(URL + '#/vente'); await page.waitForSelector('.tuile'); await page.click('.tuile'); await page.click('.tuile');
  assert.match(await page.textContent('#total'), /36\s000/); ok('panier : total 36 000 FCFA');
  await page.click('#encaisser'); await page.click('.modal footer .btn.p'); await page.waitForSelector('text=Vente enregistrée');
  await page.click('.modal footer .btn:not(.p)'); ok('vente validée');

  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#nav a'); ok('rechargement en mode avion : application ouverte');
  await page.goto(URL + '#/vente'); await page.waitForSelector('.tuile');
  await page.click('.tuile'); await page.click('#encaisser'); await page.click('.modal footer .btn.p'); await page.waitForSelector('text=Vente enregistrée'); await page.click('.modal footer .btn:not(.p)'); ok('vente hors connexion');

  await page.goto(URL + '#/stock'); await page.waitForSelector('text=Riz 50kg');
  assert.equal((await page.textContent('tbody tr td:nth-child(2)')).trim(), '7'); ok('stock déduit : 7 sacs');
  await page.close(); const p2 = await ctx.newPage(); await p2.goto(URL + '#/vente'); await p2.click('.onglets button[data-t=hist]'); await p2.waitForSelector('#hb tr');
  assert.equal(await p2.locator('#hb tr').count(), 2); ok('fermeture/réouverture : 2 ventes conservées');
  await ctx.setOffline(false);

  await p2.goto(URL + '#/accueil'); await p2.waitForSelector('.kpi'); assert.match(await p2.textContent('#vue'), /54\s000/); ok("tableau de bord : CA 54 000 FCFA");
  await p2.goto(URL + '#/rapports'); await p2.waitForSelector('#res table'); ok('rapports');
  await p2.setViewportSize({ width: 1280, height: 800 }); await p2.goto(URL + '#/accueil'); await p2.waitForSelector('.kpi');
  const dep = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); assert.ok(!dep, 'pas de débordement horizontal'); ok('affichage bureau sans débordement');
  assert.deepEqual(erreurs.filter(e => !/favicon|Failed to load resource.*net::ERR_INTERNET_DISCONNECTED/.test(e)), [], 'aucune erreur console');
  ok('aucune erreur JavaScript');
  console.log(`\n${etapes.length} vérifications réussies`);
} catch (e) { console.error('ÉCHEC :', e.message); console.error(erreurs.slice(0, 5)); await page.screenshot({ path: '/tmp/claude-0/e2e-echec.png' }).catch(() => {}); process.exitCode = 1; }
finally { await navigateur.close(); serveur.close(); }
