/**
 * MA SIGNATURE E-MAIL (08/11) : l'image que le serveur ajoute sous mes e-mails envoyés depuis Ada.
 * Réglage personnel, par compte (storage, chemin déduit de l'adresse). Aperçu, dépôt, retrait.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../services/auth';
import { findSignature, uploadSignature, removeSignature } from '../services/signature';

export function MySignaturePanel() {
  const { email } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => { if (!email) return; const s = await findSignature(email); setUrl(s?.url ?? null); };
  useEffect(() => { void refresh(); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!email) return null;
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setNote(null);
    const r = await uploadSignature(email, f);
    if (r.error) setNote(r.error); else { setNote('Signature enregistrée : elle sera sous tes prochains e-mails (le serveur la relit dans la demi-heure).'); await refresh(); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm('Retirer ta signature en image ? Tes e-mails partiront sans.')) return;
    setBusy(true); const e = await removeSignature(email); if (e) setNote(e); else { setNote('Signature retirée.'); setUrl(null); } setBusy(false);
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">Image (PNG ou JPEG, 1,5 Mo au plus) ajoutée sous le texte de chaque e-mail envoyé en ton nom depuis Ada : réponses aux demandes du site, relances de la Carte, e-mails de dossier. Conseil : environ 600 px de large, fond blanc.</p>
      {url ? (
        <div className="border border-slate-200 rounded-lg p-2 bg-white inline-block"><img src={url} alt="Ma signature" className="max-w-[320px] max-h-40 object-contain" /></div>
      ) : <p className="text-xs text-slate-500">Aucune image pour {email}.</p>}
      <div className="flex items-center gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-brand-ocean text-white hover:bg-brand-encre disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {url ? 'Remplacer l\'image' : 'Déposer une image'}
        </button>
        {url && <button onClick={() => void remove()} disabled={busy} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Retirer</button>}
      </div>
      {note && <p className="text-[11px] text-amber-700">{note}</p>}
    </div>
  );
}
