// Client « façon supabase-js » branché sur PGlite : permet de tester le vrai client + le vrai SQL + la vraie RLS, de bout en bout.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

export async function creerServeur() {
  const pg = new PGlite();
  await pg.exec(`
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true),'')::uuid $$;
    create role authenticated; create role anon;
    grant usage on schema public, auth to authenticated, anon;`);
  for (const f of fs.readdirSync(dir).sort()) await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pg.exec('grant select, insert, update, delete on all tables in schema public to authenticated');
  return pg;
}

const conv = v => v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
const convRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, conv(v)]));

export function creerClient(pg, uid, etat = { coupe: false, appels: 0 }) {
  async function run(sql, params = []) {
    if (etat.coupe) throw new TypeError('Failed to fetch');
    etat.appels++;
    await pg.query(`select set_config('request.jwt.sub', $1, false)`, [uid]);
    await pg.exec('set role authenticated');
    try { return await pg.query(sql, params); } finally { await pg.exec('reset role'); }
  }
  const erreur = e => ({ data: null, error: { message: e.message, code: e.code } });

  class Q {
    constructor(table) { this.t = table; this.f = []; this.o = []; this.cols = '*'; this.mode = 'select'; }
    select(c = '*') { this.cols = c; return this; }
    eq(c, v) { this.f.push([c, '=', v]); return this; }
    gt(c, v) { this.f.push([c, '>', v]); return this; }
    order(c, { ascending = true } = {}) { this.o.push(`${c} ${ascending ? 'asc' : 'desc'}`); return this; }
    range(a, b) { this.lim = b - a + 1; this.off = a; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single = true; return this; }
    insert(row) { this.mode = 'insert'; this.row = row; return this; }
    upsert(row, opts = {}) { this.mode = 'upsert'; this.row = row; this.opts = opts; return this; }
    update(obj) { this.mode = 'update'; this.row = obj; return this; }
    where(params) {
      if (!this.f.length) return '';
      return ' where ' + this.f.map(([c, op, v]) => { params.push(v); return `${c} ${op} $${params.length}${c.endsWith('_le') ? '::timestamptz' : ''}`; }).join(' and ');
    }
    async exec() {
      const params = [];
      try {
        let sql, res;
        if (this.mode === 'select') {
          sql = `select ${this.cols} from ${this.t}${this.where(params)}${this.o.length ? ' order by ' + this.o.join(', ') : ''}${this.lim ? ` limit ${this.lim}` : ''}${this.off ? ` offset ${this.off}` : ''}`;
          res = await run(sql, params);
          const rows = res.rows.map(convRow);
          return { data: this.single ? (rows[0] ?? null) : rows, error: null };
        }
        if (this.mode === 'insert' || this.mode === 'upsert') {
          const ks = Object.keys(this.row);
          ks.forEach(k => params.push(typeof this.row[k] === 'object' && this.row[k] !== null ? JSON.stringify(this.row[k]) : this.row[k]));
          const conflit = this.mode === 'upsert' ? (this.opts.ignoreDuplicates ? ' on conflict do nothing' : ` on conflict (${this.opts.onConflict || 'id'}) do update set ${ks.map(k => `${k}=excluded.${k}`).join(', ')}`) : '';
          sql = `insert into ${this.t}(${ks.join(',')}) values (${ks.map((_, i) => `$${i + 1}`).join(',')})${conflit}`;
          await run(sql, params); return { data: null, error: null };
        }
        if (this.mode === 'update') {
          const ks = Object.keys(this.row);
          ks.forEach(k => params.push(this.row[k]));
          const set = ks.map((k, i) => `${k}=$${i + 1}`).join(', ');
          sql = `update ${this.t} set ${set}${this.where(params)} returning ${this.cols === '*' ? 'id' : this.cols}`;
          res = await run(sql, params); return { data: res.rows.map(convRow), error: null };
        }
      } catch (e) { if (e instanceof TypeError) throw e; return erreur(e); }
    }
    then(ok, ko) { return this.exec().then(ok, ko); }
  }

  return {
    from: t => new Q(t),
    async rpc(nom, args) {
      try {
        if (nom === 'appliquer_operation') {
          const r = await run('select appliquer_operation($1,$2,$3,$4,$5::jsonb) as r', [args.p_boutique, args.p_op_id, args.p_type, args.p_appareil, JSON.stringify(args.p_payload)]);
          return { data: r.rows[0].r, error: null };
        }
        throw new Error('rpc non simulée : ' + nom);
      } catch (e) { if (e instanceof TypeError) throw e; return erreur(e); }
    },
  };
}
