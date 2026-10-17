/**
 * Une base Supabase simulée pour les tests du worker des agentes (17/10) :
 * tables en mémoire, et les gestes du client que le worker utilise (select,
 * eq, gte, in, is, order, limit, maybeSingle, insert, upsert, update, delete).
 * Les défauts de la base (id, created_at) sont posés à l'insertion.
 */
type Row = Record<string, unknown>;
export type FakeDb = Record<string, Row[]>;

let seq = 0;
class Q implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private conflict: string | null = null;
  private single = false;
  private lim = Infinity;
  private sorts: Array<{ c: string; asc: boolean }> = [];
  constructor(private db: FakeDb, private t: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c] ?? '') >= v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  not() { return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.sorts.push({ c, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  upsert(p: Row | Row[], o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.conflict = o?.onConflict ?? 'id'; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  private run(): unknown {
    const table = (this.db[this.t] ??= []);
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      return rows.map((r) => {
        const twin = this.op === 'upsert' ? table.find((x) => x[this.conflict!] === r[this.conflict!]) : null;
        if (twin) { Object.assign(twin, r); return twin; }
        const row = { id: `${this.t}-${++seq}`, created_at: new Date().toISOString(), ...r }; // défauts de la base
        table.push(row);
        return row;
      });
    }
    const hit = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') { hit.forEach((r) => Object.assign(r, this.payload)); return hit; }
    if (this.op === 'delete') { this.db[this.t] = table.filter((r) => !hit.includes(r)); return hit; }
    const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : (a as number) < (b as number) ? -1 : 1);
    const sorted = this.sorts.length ? [...hit].sort((x, y) => { for (const s of this.sorts) { const r = cmp(x[s.c], y[s.c]); if (r) return s.asc ? r : -r; } return 0; }) : hit;
    const rows = sorted.slice(0, this.lim);
    return this.single ? rows[0] ?? null : rows;
  }
  then<A, B>(ok1?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve({ data: this.run(), error: null as null }).then(ok1, ko);
  }
}

/** Le client simulé : `from(table)` et un `rpc` qui ne rend rien. */
export const fakeSupabase = (db: FakeDb) => ({ from: (t: string) => new Q(db, t), rpc: async () => ({ data: [], error: null }) });
