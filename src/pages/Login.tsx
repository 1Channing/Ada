import { useState } from 'react';
import { LogIn, UserPlus, Eye, EyeOff, KeyRound } from 'lucide-react';
import { signIn, signUp, requestPasswordReset, passwordWeakness } from '../services/auth';

/**
 * Écran de connexion — refonte « auth solide » (30/08/2026) :
 * inscription complète (prénom, nom, téléphone, email, mot de passe ×2),
 * mot de passe oublié, messages français clairs, un compte par adresse
 * (l'adresse est normalisée, et un email déjà pris le DIT au lieu du faux
 * succès silencieux qui créait la confusion des « deux comptes »).
 */
export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: 'signin' | 'signup' | 'forgot') => {
    setMode(m); setError(null); setInfo(null); setPassword(''); setPassword2(''); setShowPw(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signin') {
        const err = await signIn(email, password);
        if (err) setError(err);
      } else if (mode === 'forgot') {
        const err = await requestPasswordReset(email);
        if (err) setError(err);
        else setInfo('Email envoyé (si un compte existe avec cette adresse). Ouvre le lien reçu : il te ramène ici pour choisir un nouveau mot de passe.');
      } else {
        if (password !== password2) { setError('Les deux mots de passe ne sont pas identiques.'); return; }
        const weak = passwordWeakness(password);
        if (weak) { setError(`Mot de passe trop faible : ${weak}`); return; }
        const err = await signUp(email, password, { firstName, lastName, phone });
        if (err) setError(err);
        else setInfo('Compte créé. Si la confirmation par email est activée, clique le lien reçu — sinon tu es connecté.');
      }
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';

  const pwField = (value: string, set: (v: string) => void, label: string, autoComplete: string) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={showPw ? 'text' : 'password'}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder="••••••••"
          className={`${inputCls} pr-9`}
          autoComplete={autoComplete}
          minLength={mode === 'signin' ? 6 : 8}
          required
        />
        <button
          type="button"
          onClick={() => setShowPw(!showPw)}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          title={showPw ? 'Masquer' : 'Afficher'}
        >
          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

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
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Prénom *</label>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Antoine" className={inputCls} autoComplete="given-name" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nom *</label>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Martin" className={inputCls} autoComplete="family-name" required />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Téléphone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" className={inputCls} autoComplete="tel" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@mc-export.com"
                className={inputCls}
                autoComplete="email"
                required
              />
              {mode === 'signup' && (
                <p className="text-[11px] text-slate-400 mt-1">Une adresse = un compte. Si tu en as déjà un, utilise « Mot de passe oublié » plutôt que d'en recréer.</p>
              )}
            </div>
            {mode !== 'forgot' && pwField(password, setPassword, mode === 'signup' ? 'Mot de passe * (8 min., lettres + chiffres)' : 'Mot de passe', mode === 'signin' ? 'current-password' : 'new-password')}
            {mode === 'signup' && pwField(password2, setPassword2, 'Confirme le mot de passe *', 'new-password')}
            {mode === 'signin' && (
              <div className="text-right -mt-2">
                <button type="button" onClick={() => switchMode('forgot')} className="text-xs text-slate-500 hover:text-brand-ocean transition-colors">
                  Mot de passe oublié ?
                </button>
              </div>
            )}
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            {info && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{info}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {mode === 'signin' ? <LogIn className="w-4 h-4" /> : mode === 'forgot' ? <KeyRound className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {busy ? '…' : mode === 'signin' ? 'Se connecter' : mode === 'forgot' ? 'Envoyer le lien' : 'Créer le compte'}
            </button>
            <button
              type="button"
              onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
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

/**
 * Écran « nouveau mot de passe » — affiché quand l'utilisateur arrive par le
 * lien de récupération (PASSWORD_RECOVERY). Monté par App AVANT le reste.
 */
export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) { setError('Les deux mots de passe ne sont pas identiques.'); return; }
    setBusy(true);
    try {
      const { updatePassword } = await import('../services/auth');
      const err = await updatePassword(password);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40 pr-9';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-4">
        <div className="text-center">
          <KeyRound className="w-8 h-8 text-brand-ocean mx-auto mb-2" />
          <h1 className="font-semibold text-slate-900">Nouveau mot de passe</h1>
          <p className="text-xs text-slate-500 mt-1">8 caractères minimum, lettres et chiffres.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {[{ v: password, s: setPassword, l: 'Nouveau mot de passe' }, { v: password2, s: setPassword2, l: 'Confirme le mot de passe' }].map(({ v, s, l }) => (
            <div key={l} className="relative">
              <label className="block text-xs font-medium text-slate-600 mb-1">{l}</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={v}
                onChange={(e) => s(e.target.value)}
                className={inputCls}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1} className="absolute right-2 top-[26px] text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          ))}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy} className="w-full bg-brand-ocean hover:bg-brand-encre text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60">
            {busy ? '…' : 'Enregistrer et continuer'}
          </button>
        </form>
      </div>
    </div>
  );
}
