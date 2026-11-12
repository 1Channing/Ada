/**
 * OFFRES → FICHES MC EXPORT (12/11, Channing : « ajouter la possibilité dans les offres de transformer les
 * inspections par nos inspections PDF MC Export, en anglais de série »). Pour chaque véhicule retenu qui porte un lien
 * de rapport (Macadam, VTI, DEKRA…) : l'inspection est créée dans le FYC (ou retrouvée), lue par le worker, la fiche
 * MC Export est construite dans la langue choisie (anglais par défaut), publiée dans le bucket public, et son adresse
 * remplace le lien fournisseur dans l'offre ; le lien d'origine est gardé dans « Rapport fournisseur ». Les dommages
 * chiffrés du rapport remplissent la colonne Dommages si elle est vide. Le travail est porté par la page Offres
 * (gardée montée) : on peut fermer la fenêtre, une bannière suit l'avancement. Les inspections créées sont archivées
 * dans le FYC à la fin (retrouvables dans Archives).
 */
import { useState } from 'react';
import { Loader2, X, FileDown, AlertTriangle, Check } from 'lucide-react';
import type { OfferVehicle } from '../lib/offers/parseSupplierFile';
import type { FycLang } from '../lib/fycPdf';
import { buildFiche, publishFiche, prefetchTranslations, ensureInspection, waitInspectionRead } from '../services/fycFiche';
import { updateInspection, retryInspection, type FycInspection } from '../services/fyc';

export const FICHE_LANGS: Array<{ code: FycLang; label: string }> = [
  { code: 'en', label: 'Anglais' }, { code: 'fr', label: 'Français' }, { code: 'nl', label: 'Néerlandais' }, { code: 'de', label: 'Allemand' },
  { code: 'es', label: 'Espagnol' }, { code: 'it', label: 'Italien' }, { code: 'da', label: 'Danois' }, { code: 'sv', label: 'Suédois' },
];
export const SUPPLIER_REPORT_KEY = 'Rapport fournisseur';

export interface FicheJob { lang: FycLang; ids: string[]; progress: Record<string, string>; done: number; failed: number; running: boolean; error: string | null }
/** Le lien de rapport d'ORIGINE d'un véhicule : celui gardé en colonne libre quand une fiche l'a déjà remplacé. */
export const sourceReportUrl = (v: OfferVehicle): string | null => { const u = v.extras?.[SUPPLIER_REPORT_KEY] || v.report_url; return u && /^https?:\/\//i.test(u) ? u : null; };

/** Le travail, porté par la page : `start` lance, `job` suit. */
export function useOfferFiches(setVehicle: (id: string, patch: Partial<OfferVehicle>) => void, author: string, authorEmail: string | null, offerTitle: () => string) {
  const [job, setJob] = useState<FicheJob | null>(null);
  const start = (vehicles: OfferVehicle[], lang: FycLang, reread = false) => {
    const targets = vehicles.filter((v) => sourceReportUrl(v));
    const init: FicheJob = { lang, ids: targets.map((v) => v.id), progress: {}, done: 0, failed: 0, running: true, error: null };
    setJob(init);
    const set = (f: (j: FicheJob) => FicheJob) => setJob((j) => (j ? f(j) : j));
    const prog = (id: string, s: string) => set((j) => ({ ...j, progress: { ...j.progress, [id]: s } }));
    void (async () => {
      try {
        // 1. Inspections : créées ou retrouvées, toutes d'un coup (le worker en lit 3 toutes les 20 s).
        const insps = new Map<string, FycInspection>();
        for (const v of targets) {
          const r = await ensureInspection(sourceReportUrl(v)!, `Créée depuis l'offre « ${offerTitle()} »`);
          if (r.error || !r.row) { prog(v.id, `échec : ${r.error ?? 'inspection non créée'}`); set((j) => ({ ...j, failed: j.failed + 1 })); continue; }
          // « Refaire les inspections » (12/11) : le rapport est relu par le worker (données et photos à jour).
          if (reread && r.row.status !== 'queued') { await retryInspection(r.row.id); r.row = { ...r.row, status: 'queued' }; }
          insps.set(v.id, r.row); prog(v.id, r.row.status === 'read' ? 'rapport lu' : 'rapport en file…');
        }
        // 2. Attendre les lectures.
        const ready = new Map<string, FycInspection>();
        for (const v of targets) {
          const insp = insps.get(v.id); if (!insp) continue;
          try { ready.set(v.id, insp.status === 'read' ? insp : await waitInspectionRead(insp.id, 10 * 60_000, (s) => prog(v.id, s))); prog(v.id, 'rapport lu'); }
          catch (e) { prog(v.id, `échec : ${e instanceof Error ? e.message : String(e)}`); set((j) => ({ ...j, failed: j.failed + 1 })); }
        }
        // 3. Traductions demandées d'avance, puis fiches une à une.
        await prefetchTranslations([...ready.values()].map((insp) => ({ insp, lang })));
        for (const v of targets) {
          const insp = ready.get(v.id); if (!insp) continue;
          try {
            const { blob, note } = await buildFiche(insp, lang, { name: author, email: authorEmail }, (s) => prog(v.id, s));
            prog(v.id, 'publication…');
            const pub = await publishFiche(insp, lang, blob);
            if (pub.error || !pub.url) throw new Error(pub.error ?? 'fiche non publiée');
            const original = sourceReportUrl(v)!;
            setVehicle(v.id, {
              report_url: pub.url,
              extras: { ...v.extras, [SUPPLIER_REPORT_KEY]: original },
              ...(v.damages == null && insp.repair_cost != null ? { damages: insp.repair_cost } : {}),
            });
            void updateInspection(insp.id, { archived_at: insp.archived_at ?? new Date().toISOString() });
            prog(v.id, `fiche ${lang.toUpperCase()} publiée${note ? ` — ${note}` : ''}`);
            set((j) => ({ ...j, done: j.done + 1 }));
          } catch (e) { prog(v.id, `échec : ${e instanceof Error ? e.message : String(e)}`); set((j) => ({ ...j, failed: j.failed + 1 })); }
        }
        set((j) => ({ ...j, running: false }));
      } catch (e) { set((j) => ({ ...j, running: false, error: e instanceof Error ? e.message : String(e) })); }
    })();
  };
  return { job, start, clear: () => setJob(null) };
}

export function OfferFichesBanner({ job, onDetail, onClear }: { job: FicheJob; onDetail: () => void; onClear: () => void }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-3 flex-wrap ${job.error ? 'bg-red-50 border-red-200 text-red-800' : job.running ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
      {job.running ? <Loader2 className="w-4 h-4 animate-spin" /> : job.error || job.failed ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
      <span className="font-medium">Fiches MC Export ({job.lang.toUpperCase()})</span>
      <span>{job.running ? `${job.done} / ${job.ids.length} publiées${job.failed ? `, ${job.failed} en échec` : ''} — tu peux changer de page, ça continue.` : job.error ? `échec : ${job.error}` : `${job.done} fiches publiées${job.failed ? `, ${job.failed} en échec` : ''} : les liens de l'offre pointent sur nos fiches, le lien fournisseur est gardé dans « ${SUPPLIER_REPORT_KEY} ».`}</span>
      <button onClick={onDetail} className="text-xs underline">détail</button>
      {!job.running && <button onClick={onClear} className="ml-auto text-xs text-slate-500 hover:underline">Fermer</button>}
    </div>
  );
}

export function OfferFichesModal({ vehicles, job, onStart, onClose }: { vehicles: OfferVehicle[]; job: FicheJob | null; onStart: (lang: FycLang, reread: boolean) => void; onClose: () => void }) {
  const [lang, setLang] = useState<FycLang>('en');
  const [reread, setReread] = useState(false);
  const withLink = vehicles.filter((v) => sourceReportUrl(v));
  const running = !!job?.running;
  const rows = job ? vehicles.filter((v) => job.ids.includes(v.id)) : withLink;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">Remplacer les rapports par nos fiches MC Export</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-700" title={running ? 'Fermer : le travail continue en arrière-plan' : 'Fermer'}><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500">Pour chaque véhicule retenu qui porte un lien de rapport (Macadam, VTI, DEKRA…), Ada lit l'inspection dans le FYC, construit notre fiche PDF MC Export (photos, données, équipements, pneus, état, dans la langue choisie, sans prix d'achat ni notes), la publie, et son adresse remplace le lien fournisseur dans l'offre. Le lien d'origine est gardé dans la colonne libre « {SUPPLIER_REPORT_KEY} » ; les dommages chiffrés du rapport remplissent « Dommages » quand elle est vide. Les inspections créées sont rangées dans les archives du FYC.</p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-600">Langue des fiches
            <select value={job?.lang ?? lang} onChange={(e) => setLang(e.target.value as FycLang)} disabled={running} className="ml-2 px-2 py-1.5 rounded-lg border border-slate-300 text-sm bg-white">{FICHE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </label>
          <span className="text-xs text-slate-500">{withLink.length} véhicule{withLink.length > 1 ? 's' : ''} avec un lien de rapport sur {vehicles.length} retenu{vehicles.length > 1 ? 's' : ''}</span>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer" title="Le worker retélécharge et relit chaque rapport avant de refaire la fiche (données et photos à jour)"><input type="checkbox" checked={reread} onChange={(e) => setReread(e.target.checked)} disabled={running} className="rounded border-slate-300" /> Refaire les inspections (relire les rapports)</label>
        </div>
        {running && <p className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">{job!.done} / {job!.ids.length} fiches publiées. Les rapports sont lus par le worker (3 toutes les 20 s), puis chaque fiche est construite : compte une à deux minutes pour dix véhicules. Tu peux fermer cette fenêtre.</p>}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400"><th className="py-1.5 pr-3">Véhicule</th><th className="py-1.5 pr-3">VIN</th><th className="py-1.5 pr-3">Rapport</th><th className="py-1.5 pr-3">État</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="py-1.5 pr-3 font-medium text-slate-900">{v.brand} {v.model}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-500">{v.vin ?? '—'}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-500 truncate max-w-[220px]">{(sourceReportUrl(v) ?? '').replace(/^https?:\/\//, '').slice(0, 50)}</td>
                <td className={`py-1.5 pr-3 text-xs whitespace-nowrap ${/^échec/.test(job?.progress[v.id] ?? '') ? 'text-red-700' : 'text-slate-600'}`}>{job?.progress[v.id] ?? (v.extras?.[SUPPLIER_REPORT_KEY] ? 'déjà remplacé (sera refait)' : 'à faire')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {job?.error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{job.error}</p>}
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">{running ? 'Fermer (continue en arrière-plan)' : 'Fermer'}</button>
          <button onClick={() => onStart(lang, reread)} disabled={running || withLink.length === 0} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white disabled:opacity-50">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {running ? `En cours… ${job!.done} / ${job!.ids.length}` : `Créer les fiches (${withLink.length})`}</button>
        </div>
      </div>
    </div>
  );
}
