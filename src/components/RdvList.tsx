/**
 * RENDEZ-VOUS PRIS (09/11, Channing : « lorsqu'un commercial valide un rdv, un petit onglet dans les négociations
 * pour retrouver les rendez-vous confirmés et voir toutes les infos et les notes »).
 *
 * Les négociations archivées avec « Rendez-vous pris ! » : les miennes (fiche complète : prix, numéro, annonce,
 * journal des notes, réactivable) et celles des collègues de mon organisation (titre, annonce, numéro, notes, qui).
 * Même périmètre que les Archives : jamais une autre organisation.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, ExternalLink, Phone, RotateCcw, Search, StickyNote } from 'lucide-react';
import { useAuth } from '../services/auth';
import { listArchivedNegotiations, listNegotiationConflicts, reactivateNegotiation, type Negotiation, type NegoConflict } from '../services/workflow';
import { parseJournal, fmtStamp } from '../lib/noteJournal';
import { fmtPhone } from '../lib/phoneKey';
import { ListingLink } from './ListingLink';

interface Rdv {
  key: string; id: string | null; mine: boolean; owner: string; title: string; listing_url: string; phone: string | null; notes: string;
  archived_at: string | null; created_at: string | null; asking_price: number | null; negotiated_price: number | null; photos: number;
}
const fmtEur = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} €`);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function RdvList({ onChanged }: { onChanged?: () => void }) {
  const { userId } = useAuth();
  const [rows, setRows] = useState<Rdv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const reload = () => {
    setLoading(true);
    Promise.all([listArchivedNegotiations(), listNegotiationConflicts()]).then(([mine, team]: [Negotiation[], NegoConflict[]]) => {
      const out: Rdv[] = mine.filter((n) => n.outcome === 'rdv').map((n) => ({
        key: n.id, id: n.id, mine: true, owner: 'toi', title: n.title, listing_url: n.listing_url, phone: n.phone ?? null, notes: n.notes,
        archived_at: n.archived_at ?? null, created_at: n.created_at, asking_price: n.asking_price, negotiated_price: n.negotiated_price, photos: n.photos.length,
      }));
      for (const c of team) {
        if (c.owner_id === userId || c.status !== 'archived' || c.outcome !== 'rdv') continue;
        out.push({
          key: `${c.owner_id}|${c.listing_url}|${c.archived_at ?? ''}`, id: null, mine: false, owner: c.owner_name, title: c.title || c.listing_url, listing_url: c.listing_url,
          phone: c.phone ?? null, notes: c.notes, archived_at: c.archived_at ?? null, created_at: c.created_at ?? null, asking_price: null, negotiated_price: null, photos: 0,
        });
      }
      setRows(out.sort((a, b) => (b.archived_at ?? '').localeCompare(a.archived_at ?? '')));
      setError(null);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? rows.filter((r) => `${r.title} ${r.owner} ${r.phone ?? ''} ${r.notes}`.toLowerCase().includes(q)) : rows), [rows, q]);
  const mineCount = rows.filter((r) => r.mine).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm text-slate-600">{rows.length} rendez-vous pris dans ton organisation{mineCount ? ` · ${mineCount} à toi` : ''}. Le plus récent d'abord ; clique une ligne pour tout voir.</p>
        <div className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Véhicule, collègue, numéro, note…" className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm w-72" />
        </div>
      </div>
      {error && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</p>}
      {loading ? <p className="text-sm text-slate-400 py-8 text-center">Chargement…</p> : shown.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 text-sm">
          {rows.length === 0 ? 'Aucun rendez-vous pris pour l\'instant — il s\'enregistre depuis le menu ⋯ d\'une négociation, « Après l\'appel », puis « Rendez-vous pris ! ».' : 'Rien ne correspond à la recherche.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
          {shown.map((r) => {
            const open = openId === r.key;
            const journal = parseJournal(r.notes);
            return (
              <div key={r.key} className="px-4 py-3">
                <button onClick={() => setOpenId(open ? null : r.key)} className="w-full text-left flex items-center gap-3">
                  <CalendarCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 truncate">{r.title}</span>
                    <span className="block text-xs text-slate-500 truncate">rendez-vous pris le {fmtDate(r.archived_at)} · {r.mine ? 'toi' : r.owner}{r.phone ? ` · ${fmtPhone(r.phone)}` : ''}{r.mine && r.negotiated_price != null ? ` · négocié ${fmtEur(r.negotiated_price)}` : ''}</span>
                  </span>
                  {journal.entries.length > 0 && <span className="text-[11px] text-slate-500 flex items-center gap-1 shrink-0"><StickyNote className="w-3.5 h-3.5" /> {journal.entries.length} note{journal.entries.length > 1 ? 's' : ''}</span>}
                  <span className="text-[11px] font-medium rounded-full px-2 py-0.5 border bg-emerald-50 text-emerald-800 border-emerald-300 shrink-0">Rendez-vous pris</span>
                </button>
                {open && (
                  <div className="mt-3 ml-7 space-y-2 text-sm">
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-slate-700">
                      <p><span className="text-slate-500">Annonce : </span>{r.listing_url?.startsWith('http') ? <ListingLink href={r.listing_url} className="text-brand-ocean hover:underline inline-flex items-center gap-1 break-all">{r.listing_url} <ExternalLink className="w-3 h-3 shrink-0" /></ListingLink> : '—'}</p>
                      <p><span className="text-slate-500">Vendeur : </span>{r.phone ? <a href={`tel:${r.phone.replace(/\s/g, '')}`} className="text-brand-ocean hover:underline inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {fmtPhone(r.phone)}</a> : '—'}</p>
                      <p><span className="text-slate-500">Commercial : </span>{r.mine ? 'toi' : r.owner}</p>
                      <p><span className="text-slate-500">Négociation ouverte le : </span>{fmtDate(r.created_at)}</p>
                      {r.mine && <p><span className="text-slate-500">Prix demandé : </span>{fmtEur(r.asking_price)}</p>}
                      {r.mine && <p><span className="text-slate-500">Prix négocié : </span>{fmtEur(r.negotiated_price)}</p>}
                      {r.mine && r.photos > 0 && <p><span className="text-slate-500">Photos : </span>{r.photos}</p>}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium text-slate-600 mb-1">Notes</p>
                      {journal.entries.length === 0 && !journal.legacy ? <p className="text-xs text-slate-400">Aucune note.</p> : (
                        <div className="space-y-1.5">
                          {journal.legacy && <pre className="whitespace-pre-wrap font-sans text-slate-700 text-sm">{journal.legacy}</pre>}
                          {journal.entries.map((e, i) => (
                            <div key={i} className="text-sm">
                              {e.at && <span className="text-[11px] text-slate-400 mr-2">{fmtStamp(e.at)}</span>}
                              <span className="whitespace-pre-wrap text-slate-800">{e.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {r.id && (
                      <button onClick={async () => { if (!confirm('Remettre cette négociation en cours ? Elle quitte les rendez-vous pris.')) return; const err = await reactivateNegotiation(r.id!); if (err) setError(err); else { reload(); onChanged?.(); } }} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                        <RotateCcw className="w-3.5 h-3.5" /> Remettre en cours
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
