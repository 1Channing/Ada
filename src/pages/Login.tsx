import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { signIn, signUp } from '../services/auth';

/** Écran de connexion — même langage visuel que le bandeau (Direction B). */
export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signin') {
        const err = await signIn(email.trim(), password);
        if (err) setError(err === 'Invalid login credentials' ? 'Email ou mot de passe incorrect.' : err);
      } else {
        const err = await signUp(email.trim(), password, displayName);
        if (err) setError(err);
        else setInfo('Compte créé. Si la confirmation par email est activée, vérifie ta boîte mail — sinon tu es connecté.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
          <div className="bg-gradient-to-r from-brand-encre via-brand-ocean to-[#3F85C2] px-6 py-8 text-center">
            <img
              src="/logo-mark.png"
              alt="MC Export"
              className="h-12 mx-auto mb-3"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <h1 className="text-white text-xl font-semibold tracking-wide">ADA</h1>
            <p className="text-blue-100 text-xs mt-1">Market intelligence · MC Export</p>
          </div>
          <form onSubmit={submit} className="p-6 space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Prénom d'affichage</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Antoine"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
                  autoComplete="given-name"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@mc-export.com"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {info && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{info}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {mode === 'signin' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null); }}
              className="w-full text-xs text-slate-500 hover:text-brand-ocean transition-colors"
            >
              {mode === 'signin' ? 'Première visite ? Créer un compte' : 'Déjà un compte ? Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
