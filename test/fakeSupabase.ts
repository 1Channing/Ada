/**
 * Une base Supabase simulée pour les tests du worker des agentes (17/10) :
 * tables en mémoire, et les gestes du client que le worker utilise (select,
 * eq, neq, gte, lt, in, is, ilike, order, limit, range, maybeSingle, single, insert, upsert, update, delete),
 * et les fonctions (rpc) qu'un test simule.
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
  private maybeOne = false;
  private lim = Infinity;
  private off = 0;
  private one = false;
  private sorts: Array<{ c: string; asc: boolean }> = [];
  constructor(private db: FakeDb, private t: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c] ?? '') >= v); return this; }
  lt(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) < v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  not() { return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  /** Comme PostgreSQL : sans casse, « % » = n'importe quelle suite, « _ » = un caractère. */
  ilike(c: string, pattern: string) {
    const re = new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
    this.filters.push((r) => re.test(String(r[c] ?? '')));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) { this.sorts.push({ c, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.off = from; this.lim = to - from + 1; return this; }
  maybeSingle() { this.maybeOne = true; return this; }
  /** Une seule ligne (après une insertion : la ligne écrite). */
  single() { this.one = true; return this; }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  upsert(p: Row | Row[], o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.conflict = o?.onConflict ?? 'id'; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  private run(): unknown {
    const table = (this.db[this.t] ??= []);
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      return rows.map((r) => {
        // Clé de conflit simple ou composée (« site,site_dealer_id »).
        const keys = (this.conflict ?? 'id').split(',').map((k) => k.trim());
        const twin = this.op === 'upsert' ? table.find((x) => keys.every((k) => x[k] !== undefined && x[k] === r[k])) : null;
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
    const rows = sorted.slice(this.off, this.off + this.lim);
    return this.maybeOne ? rows[0] ?? null : rows;
  }
  then<A, B>(ok1?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    const data = this.run();
    return Promise.resolve({ data: this.one && Array.isArray(data) ? data[0] ?? null : data, error: null as null }).then(ok1, ko);
  }
}

/** Une fonction de la base simulée : ce qu'elle rend pour ces arguments. */
export type FakeRpc = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

/** Le client simulé : `from(table)`, et un `rpc` qui ne rend rien sauf les fonctions simulées par le test. */
export const fakeSupabase = (db: FakeDb, rpcs: Record<string, FakeRpc> = {}) => ({
  from: (t: string) => new Q(db, t),
  rpc: async (fn: string, args: Record<string, unknown> = {}) => (rpcs[fn] ? rpcs[fn](args) : { data: [], error: null }),
});
