/**
 * Bouton de signalement (à droite de la nav, à côté de la cloche) — les
 * commerciaux déposent un problème rencontré ou une suggestion, avec capture
 * d'écran. Tout atterrit dans `ada_feedback` : c'est le backlog vivant qu'on
 * dépile en priorité à chaque session de développement.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageSquareWarning, X, Loader2, Check, RotateCcw, ImagePlus, Trash2 } from 'lucide-react';
import {
  loadFeedback, submitFeedback, setFeedbackStatus, prepareScreenshot,
  FEEDBACK_KIND_LABEL,
} from '../services/feedback';
import type { FeedbackItem, FeedbackKind } from '../services/feedback';

function contributorNames(): string[] {
  try {
    const raw = localStorage.getItem('ada_contributor_names');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function FeedbackCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Formulaire
  const [author, setAuthor] = useState(contributorNames()[0] ?? '');
  const [kind, setKind] = useState<FeedbackKind>('probleme');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const openCount = items.filter((i) => i.status === 'open').length;

  const reload = async () => {
    setLoading(true);
    const { items: rows, error } = await loadFeedback();
    setItems(rows);
    setLoadError(error);
    setLoading(false);
  };
  useEffect(() => { void reload(); }, []);

  const attachFile = async (file: File) => {
    setFormNotice(null);
    const { dataUrl, error } = await prepareScreenshot(file);
    if (!dataUrl) { setFormNotice(error ?? 'Capture refusée'); return; }
    setScreenshot(dataUrl);
  };

  // Coller une capture directement dans le panneau (Cmd/Ctrl+V).
  const onPaste = (e: React.ClipboardEvent) => {
    const img = [...e.clipboardData.items].find((it) => it.type.startsWith('image/'));
    const file = img?.getAsFile();
    if (file) void attachFile(file);
  };

  const handleSubmit = async () => {
    if (!author.trim()) { setFormNotice('Votre nom est requis.'); return; }
    if (!message.trim()) { setFormNotice('Décrivez le problème ou la suggestion.'); return; }
    setBusy(true);
    const res = await submitFeedback({
      author, kind, message,
      page: window.location.pathname,
      screenshot,
    });
    setBusy(false);
    if (!res.ok) { setFormNotice(`Envoi impossible : ${res.error}`); return; }
    // Mémoriser le nom pour la prochaine fois (partagé avec l'ingestion).
    try {
      const names = [author.trim(), ...contributorNames().filter((n) => n !== author.trim())].slice(0, 12);
      localStorage.setItem('ada_contributor_names', JSON.stringify(names));
    } catch { /* stockage local indisponible */ }
    setMessage('');
    setScreenshot(null);
    setFormNotice('Signalement enregistré — merci, il est dans le backlog. ✅');
    await reload();
  };

  const toggleStatus = async (item: FeedbackItem) => {
    await setFeedbackStatus(item.id, item.status === 'open', author || 'équipe');
    await reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 rounded-lg transition-colors ${open ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
        title="Signaler un problème ou une suggestion"
      >
        <MessageSquareWarning className="w-5 h-5" />
        {openCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-violet-500 text-zinc-950 text-[10px] font-bold flex items-center justify-center">
            {openCount > 99 ? '99+' : openCount}
          </span>
        )}
      </button>

      {open && (
        <div
          onPaste={onPaste}
          className="absolute right-0 top-11 z-50 w-[480px] max-w-[92vw] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Signaler — problème ou suggestion</h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Un défaut sur ADA, une idée d'amélioration ? Déposez-la ici avec une capture :
            tout arrive dans le backlog de développement et sera traité en priorité.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                list="feedback-names"
                placeholder="Votre nom"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs"
              />
              <datalist id="feedback-names">
                {contributorNames().map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as FeedbackKind)}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs"
            >
              <option value="probleme">Problème rencontré</option>
              <option value="suggestion">Suggestion</option>
            </select>
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Décrivez : où, quoi, comment le reproduire…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs resize-y"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs"
            >
              <ImagePlus className="w-3.5 h-3.5" /> Capture d'écran
            </button>
            <span className="text-[11px] text-zinc-600">ou collez une image (Ctrl+V)</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f); e.target.value = ''; }}
            />
          </div>
          {screenshot && (
            <div className="relative inline-block">
              <img src={screenshot} alt="capture jointe" className="max-h-28 rounded border border-zinc-700" />
              <button
                onClick={() => setScreenshot(null)}
                className="absolute -top-2 -right-2 p-1 rounded-full bg-zinc-800 border border-zinc-600 text-zinc-400 hover:text-red-400"
                title="Retirer la capture"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {formNotice && <p className="text-xs text-amber-400">{formNotice}</p>}

          <button
            onClick={handleSubmit}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquareWarning className="w-3.5 h-3.5" />}
            Envoyer le signalement
          </button>

          <div className="border-t border-zinc-800 pt-2 space-y-2 max-h-64 overflow-auto">
            {loading && <p className="text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…</p>}
            {loadError && <p className="text-xs text-red-400">Liste indisponible : {loadError}</p>}
            {!loading && !loadError && items.length === 0 && (
              <p className="text-xs text-zinc-600">Aucun signalement pour l'instant.</p>
            )}
            {items.map((i) => (
              <div key={i.id} className={`rounded-lg border p-2 space-y-1 ${i.status === 'open' ? 'border-zinc-700 bg-zinc-950' : 'border-zinc-800 bg-zinc-900/50 opacity-70'}`}>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${i.kind === 'probleme' ? 'bg-red-900/40 text-red-300' : 'bg-blue-900/40 text-blue-300'}`}>
                    {FEEDBACK_KIND_LABEL[i.kind]}
                  </span>
                  <span className="text-zinc-400 font-medium">{i.author || '—'}</span>
                  <span className="text-zinc-600">{i.createdAt.slice(0, 16).replace('T', ' ')}</span>
                  {i.page && <span className="text-zinc-600 font-mono">{i.page}</span>}
                  <button
                    onClick={() => void toggleStatus(i)}
                    className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                    title={i.status === 'open' ? 'Marquer traité' : 'Rouvrir'}
                  >
                    {i.status === 'open' ? <Check className="w-3 h-3" /> : <RotateCcw className="w-3 h-3" />}
                    {i.status === 'open' ? 'Traité' : 'Rouvrir'}
                  </button>
                </div>
                <p className="text-xs text-zinc-300 whitespace-pre-wrap">{i.message}</p>
                {i.screenshot && (
                  <a href={i.screenshot} target="_blank" rel="noreferrer">
                    <img src={i.screenshot} alt="capture" className="max-h-20 rounded border border-zinc-800" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
