/**
 * LES PANNES DE L'IA, EN CLAIR (18/10 — Channing a vu passer, dans l'onglet
 * Live, « 400 {"type":"error"… This API key is not scoped to a workspace… »).
 * Une erreur de l'API Anthropic → ce qu'il faut faire, en français.
 *
 * Les pannes de réglage (crédits, clé, espace de travail, droits) ne se
 * règlent pas seules : le worker met alors le travail automatique en pause
 * une heure — pour Ada comme pour Dana, qui partagent la clé — et une tâche
 * lancée à la main réessaie tout de suite. Les autres erreurs (surcharge,
 * coupure) gardent leur message, sans le JSON autour.
 * Logique pure, partagée par le worker et l'onglet Live ; testée par
 * test/agents-recherche.test.ts.
 */

export type AiProblemKind = 'credits' | 'workspace' | 'workspace_id' | 'key' | 'permission';
export interface AiProblem {
  kind: AiProblemKind;
  /** Quelques mots, pour une ligne du fil en direct. */
  short: string;
  /** Ce qu'il faut faire. */
  text: string;
}

const PROBLEMS: Record<AiProblemKind, Omit<AiProblem, 'kind'>> = {
  credits: {
    short: 'crédits épuisés',
    text: 'crédits API Anthropic épuisés : ajoutez-en dans la console Anthropic (Plans et facturation), puis relancez la tâche',
  },
  workspace: {
    short: 'clé rattachée à aucun espace de travail',
    text: 'la clé API Anthropic n\'est rattachée à aucun espace de travail. Le plus simple : dans la console Anthropic (Settings › API keys › Create key), recréez la clé en choisissant l\'espace de travail « Default », puis remplacez AGENTS_ANTHROPIC_API_KEY sur le worker (Railway). Ou gardez cette clé et indiquez l\'identifiant de l\'espace de travail (wrkspc_…, colonne ID de Settings › Workspaces) dans AGENTS_ANTHROPIC_WORKSPACE_ID',
  },
  workspace_id: {
    short: 'espace de travail introuvable',
    text: 'l\'espace de travail indiqué dans AGENTS_ANTHROPIC_WORKSPACE_ID est invalide, ou la clé n\'y a pas accès : vérifiez l\'identifiant (wrkspc_…, colonne ID de Settings › Workspaces dans la console Anthropic)',
  },
  key: {
    short: 'clé API refusée',
    text: 'clé API Anthropic refusée (désactivée, expirée, supprimée ou mal copiée) : vérifiez AGENTS_ANTHROPIC_API_KEY sur le worker (Railway)',
  },
  permission: {
    short: 'droits insuffisants',
    text: 'la clé API Anthropic n\'a pas les droits nécessaires (rôle ou espace de travail) : vérifiez-la dans la console Anthropic (Settings › API keys)',
  },
};

/** Une panne de réglage de l'IA (crédits, clé, espace de travail, droits), ou null si l'erreur est d'une autre nature. */
export function aiProblemOf(raw: string | null | undefined, status?: number | null): AiProblem | null {
  const m = String(raw ?? '');
  const kind: AiProblemKind | null =
    /credit balance|insufficient_quota|billing|crédits api anthropic épuisés/i.test(m) ? 'credits'
      : /not scoped to a workspace|anthropic-workspace-id is required|rattachée à aucun espace de travail/i.test(m) ? 'workspace'
        : /anthropic-workspace-id header must be|workspace `[^`]*` not found|espace de travail indiqué/i.test(m) ? 'workspace_id'
          : status === 401 || /authentication_error|invalid x-api-key|invalid api key|clé api anthropic refusée/i.test(m) ? 'key'
            : status === 403 || /permission_error|pas les droits nécessaires/i.test(m) ? 'permission'
              : null;
  return kind ? { kind, ...PROBLEMS[kind] } : null;
}

/** Le message d'une erreur de l'API, sans le JSON autour (« 400 {"type":"error","error":{…,"message":"…"}} » → « … »). */
export function apiMessage(raw: string | null | undefined): string {
  const s = String(raw ?? '');
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  const text = m ? m[1].replace(/\\(["\\/])/g, '$1') : s.replace(/^API Claude\s*\d*\s*:\s*/, '');
  return text.trim().slice(0, 300);
}
