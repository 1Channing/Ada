/**
 * SINGLE UNIT (12/11, Channing : « ajouter des single units sur nos listes, et en même temps créer l'inspection
 * façon MC Export »). Le bloc texte est collé tel quel, les photos (album PDF ou images) déposées à côté ; l'aperçu
 * montre ce qui a été reconnu avant d'ajouter. La page Offres fait le reste (ligne dans l'offre, inspection, fiche).
 */
import { useMemo, useState } from 'react';
import { X, Loader2, ImagePlus, Car } from 'lucide-react';
import { parseSingleUnits, type SingleUnit } from '../lib/offers/singleUnit';
import type { FycLang } from '../lib/fycPdf';
import { FICHE_LANGS } from './OfferFiches';
import { fmtKm, fmtDate, fmtEur } from '../lib/offers/exportOfferXlsx';

export interface SingleUnitOptions { fiche: boolean; lang: FycLang; files: File[] }

const EXAMPLE = `SUZUKI IGNIS 1.2 DUALJET 83ps

27/03/2023
30 000 km
122g/km

VIN: JSAMFH91S00247063

Cruise control
Automatic AC
Camera
Heated seats

Service history Suzuki
Default (pictures attached)

14 000 netto delivered`;

/** `hidden` : la fenêtre reste montée (bloc et photos conservés) pendant que la page travaille, refermée par l'utilisateur
 *  (12/11, Channing : « il faut pouvoir fermer cette fenêtre le temps que ça charge »). */
export function SingleUnitModal({ busy, status, hidden = false, onAdd, onClose }: { busy: boolean; status: string | null; hidden?: boolean; onAdd: (units: SingleUnit[], opts: SingleUnitOptions) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fiche, setFiche] = useState(true);
  const [lang, setLang] = useState<FycLang>('en');
  const units = useMemo(() => parseSingleUnits(text), [text]);
  const photosForOne = files.length > 0 && units.length === 1;
  const chip = (s: string | null | undefined, cls = 'bg-slate-100 text-slate-700') => (s ? <span className={`px-1.5 py-0.5 rounded text-[11px] ${cls}`}>{s}</span> : null);
  return (
    <div className={`fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 ${hidden ? 'hidden' : ''}`} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2"><Car className="w-5 h-5 text-brand-ocean" /><h2 className="font-semibold text-slate-900">Single unit</h2></div>
          <button onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-slate-600">Le bloc de l'unité, collé tel quel</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} rows={16} disabled={busy}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-brand-ocean disabled:bg-slate-50" />
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 cursor-pointer hover:border-brand-ocean">
              <ImagePlus className="w-4 h-4 text-slate-400" />
              <span>{files.length ? `${files.length} fichier${files.length > 1 ? 's' : ''} : ${files.map((f) => f.name).join(', ')}` : 'Photos : album PDF ou images (facultatif)'}</span>
              <input type="file" accept=".pdf,application/pdf,image/*" multiple className="hidden" disabled={busy} onChange={(e) => { setFiles([...(e.target.files ?? [])]); e.currentTarget.value = ''; }} />
            </label>
            {files.length > 0 && units.length > 1 && <p className="text-xs text-amber-700">Plusieurs unités reconnues : les photos ne sont rangées que pour une unité à la fois. Colle-les une par une pour leur joindre des photos.</p>}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={fiche} onChange={(e) => setFiche(e.target.checked)} disabled={busy} className="rounded" />
              Créer l'inspection et publier la fiche MC Export
            </label>
            {fiche && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <span className="text-slate-600">Langue de la fiche</span>
                <select value={lang} onChange={(e) => setLang(e.target.value as FycLang)} disabled={busy} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
                  {FICHE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{units.length ? `${units.length} unité${units.length > 1 ? 's' : ''} reconnue${units.length > 1 ? 's' : ''}` : 'Aperçu de ce qui est reconnu'}</p>
            {units.map((u, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2 text-sm">
                <div className="font-semibold text-slate-900">{u.brand} {u.model} <span className="font-normal text-slate-500">{u.version}</span></div>
                <div className="flex flex-wrap gap-1">
                  {chip(u.reg_date ? fmtDate(u.reg_date) : u.year ? String(u.year) : null)}
                  {chip(u.km != null ? fmtKm(u.km) : null)}
                  {chip(u.co2 != null ? `${u.co2} g/km` : null)}
                  {chip(u.fuel)}{chip(u.gearbox)}{chip(u.power_ch ? `${u.power_ch} ch` : null)}{chip(u.color)}
                  {chip(u.vin, 'bg-blue-50 text-brand-encre font-mono')}
                </div>
                {!u.vin && <p className="text-xs text-amber-700">VIN non trouvé : la ligne sera sans châssis (modifiable au crayon).</p>}
                {u.options.length > 0 && <p className="text-slate-700"><span className="text-slate-500">Options (dans l'inspection) :</span> {u.options.join(' · ')}</p>}
                {u.service && <p className="text-slate-700"><span className="text-slate-500">Entretien :</span> {u.service}</p>}
                {u.defects.length > 0 && <p className="text-slate-700"><span className="text-slate-500">Défauts :</span> {u.defects.join(' ; ')}</p>}
                <p className="text-slate-700"><span className="text-slate-500">Prix MC Export :</span> {u.price != null ? `${fmtEur(u.price)}${u.price_ttc ? ' TTC' : ' HT'}${u.price_note ? ` — ${u.price_note}` : ''}` : 'non lu (à saisir dans l\'offre)'}</p>
                {u.rest.length > 0 && <p className="text-xs text-slate-400">Non lu : {u.rest.join(' · ')}</p>}
              </div>
            ))}
            {status && <p className="text-sm text-brand-encre flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{status}</p>}
            {busy && <p className="text-xs text-slate-500">Tu peux fermer cette fenêtre : le travail continue, la bannière en haut de la page montre l'avancement.</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">Fermer</button>
          <button onClick={() => onAdd(units, { fiche, lang, files: photosForOne ? files : [] })} disabled={busy || units.length === 0}
            className="px-4 py-2 rounded-lg bg-brand-ocean hover:bg-brand-encre text-white text-sm font-medium disabled:opacity-50">
            {busy ? 'En cours…' : `Ajouter à l'offre${fiche ? ' + fiche' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
