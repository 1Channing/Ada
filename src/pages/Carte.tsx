/**
 * CARTE EUROPE DU RÉSEAU (07/09/2026 — chantier réservé le 03/09, GO 07/09).
 * Exigence Channing : « UI magnifique et fluide, carte interactive (pan/zoom,
 * épingles, panneaux dépliants, filtres en direct) », pas besoin de rues.
 *
 * Choix : SVG maison — projection conique conforme de Lambert (l'Europe sans
 * l'étirement de Mercator sur la Scandinavie), géométrie des pays extraite
 * une fois (src/data/europe.json, 61 pays, chargée à la demande), pan/zoom
 * par transformation d'un seul groupe (souris, molette, tactile à deux
 * doigts), épingles à taille constante, regroupement des épingles proches
 * selon le zoom. Aucune dépendance externe à l'exécution.
 *
 * Données : services/network (tables network_contacts / _models, temps réel).
 * Édition : droit « carte:edition » (Équipe) — la base refuse sans lui.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin, Plus, Search, Pencil, Trash2, Crosshair, ExternalLink, Phone, Mail, X,
  ZoomIn, ZoomOut, Maximize2, Move, Loader2, Check, Car,
} from 'lucide-react';
import { useAuth } from '../services/auth';
import { canSeeTab } from '../lib/appTabs';
import {
  loadNetwork, saveContact, deleteContact, moveContact, saveContactModels, subscribeNetwork, contactMatchesQuery,
  KIND_LABEL, ROLE_LABEL, RELATION_LABEL, RELATION_SUGGESTIONS,
  type NetworkContact, type ContactInput, type ContactKind, type ContactRole,
} from '../services/network';
import { CITIES, COUNTRY_NAMES, COUNTRY_CENTROIDS, NETWORK_COUNTRIES, findCities, findCity } from '../data/cities';

// ── Projection : conique conforme de Lambert (Europe) ────────────────────────
const D2R = Math.PI / 180;
const PHI1 = 43 * D2R, PHI2 = 62 * D2R, PHI0 = 52 * D2R, LAM0 = 10 * D2R;
const N = Math.log(Math.cos(PHI1) / Math.cos(PHI2)) / Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2));
const F = (Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), N)) / N;
const RHO0 = F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), N);
const SCALE = 1500;
const W = 1000, H = 820; // espace SVG de base
function project(lat: number, lng: number): [number, number] {
  const phi = lat * D2R, lam = lng * D2R;
  const rho = F / Math.pow(Math.tan(Math.PI / 4 + phi / 2), N);
  const x = rho * Math.sin(N * (lam - LAM0));
  const y = RHO0 - rho * Math.cos(N * (lam - LAM0));
  return [W / 2 + x * SCALE, H / 2 - y * SCALE + 60];
}
function unproject(px: number, py: number): [number, number] {
  const x = (px - W / 2) / SCALE, y = (H / 2 + 60 - py) / SCALE;
  const rho = Math.sign(N) * Math.sqrt(x * x + (RHO0 - y) * (RHO0 - y));
  const theta = Math.atan2(x, RHO0 - y);
  const phi = 2 * Math.atan(Math.pow(F / rho, 1 / N)) - Math.PI / 2;
  const lam = LAM0 + theta / N;
  return [phi / D2R, lam / D2R];
}

interface CountryGeo { id: string; name: string; rings: Array<Array<[number, number]>> }
interface View { k: number; tx: number; ty: number }
const ROLE_COLOR: Record<ContactRole, string> = { vendeur: '#2C5F9E', acheteur: '#EA7A2B', les_deux: '#0f9d8a' };
const RELATION_COLOR: Record<string, string> = { chaud: '#ef4444', tiede: '#f59e0b', froid: '#94a3b8', nouveau: '#8b5cf6' };
const FLAG: Record<string, string> = { FR: '🇫🇷', NL: '🇳🇱', BE: '🇧🇪', DE: '🇩🇪', DK: '🇩🇰', SE: '🇸🇪', IT: '🇮🇹', ES: '🇪🇸', HU: '🇭🇺', LT: '🇱🇹', LU: '🇱🇺', AT: '🇦🇹', CH: '🇨🇭', PL: '🇵🇱', CZ: '🇨🇿', PT: '🇵🇹', NO: '🇳🇴', FI: '🇫🇮', IE: '🇮🇪', GB: '🇬🇧', EE: '🇪🇪', LV: '🇱🇻', RO: '🇷🇴', SK: '🇸🇰', SI: '🇸🇮', HR: '🇭🇷', BG: '🇧🇬', GR: '🇬🇷', RS: '🇷🇸' };

const emptyInput = (country = 'NL'): ContactInput => ({
  name: '', kind: 'concession', role: 'vendeur', country, city: '', lat: null, lng: null,
  contact_name: '', phone: '', email: '', website: '', relation: '', vehicle_types: '', monthly_volume: '',
  opportunity: '', margin: '', reliability: '', comment: '', notes: '', market_share: null, stock_total: null,
});

export function Carte() {
  const { allowedTabs, isAdmin, userId } = useAuth();
  const canEdit = canSeeTab(allowedTabs, isAdmin, 'carte:edition');

  const [geo, setGeo] = useState<CountryGeo[] | null>(null);
  const [contacts, setContacts] = useState<NetworkContact[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverCountry, setHoverCountry] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'tous' | ContactRole>('tous');
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactInput | null>(null);
  const [editModels, setEditModels] = useState<Array<{ brand: string; model: string; qty: number | null; note: string }>>([]);
  const [placing, setPlacing] = useState<'form' | string | null>(null); // 'form' = épingle du formulaire, sinon id du contact à déplacer
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  // ── Données ──
  const reload = useCallback(async () => {
    const r = await loadNetwork();
    setContacts(r.contacts);
    setLoadError(r.error);
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
    const off = subscribeNetwork(() => { void reload(); });
    return off;
  }, [reload]);
  useEffect(() => {
    void import('../data/europe.json').then((m) => setGeo((m.default ?? m) as unknown as CountryGeo[]));
  }, []);

  // ── Géométrie projetée (une fois) ──
  const countryPaths = useMemo(() => {
    if (!geo) return [];
    return geo.map((c) => {
      let d = '';
      for (const ring of c.rings) {
        ring.forEach(([lng, lat], i) => {
          const [x, y] = project(lat, lng);
          d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        });
        d += 'Z';
      }
      return { id: c.id, name: c.name, d, network: isNetworkCountry(c.name) };
    });
  }, [geo]);

  // ── Vue (pan/zoom) ──
  const svgRef = useRef<SVGSVGElement>(null);
  // `view` = vue VALIDÉE (React : regroupement des épingles, libellés). Pendant
  // un geste, la transformation est appliquée DIRECTEMENT au DOM (viewRef +
  // applyLive) sans re-rendre les 61 tracés — constat 07/09 : « la carte lag
  // énormément » sur un PC modeste, chaque mouvement de souris re-rendait la
  // géométrie entière avec son ombre portée.
  const [view, setView] = useState<View>(() => fitView());
  const viewRef = useRef(view);
  const mapGRef = useRef<SVGGElement>(null);
  const pinsGRef = useRef<SVGGElement>(null);
  const rafRef = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const applyLive = (v: View) => {
    viewRef.current = v;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const { k, tx, ty } = viewRef.current;
      mapGRef.current?.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
      const pins = pinsGRef.current?.children;
      if (pins) for (const el of pins) {
        const x = Number((el as SVGGElement).dataset.x), y = Number((el as SVGGElement).dataset.y);
        (el as SVGGElement).setAttribute('transform', `translate(${x * k + tx} ${y * k + ty})`);
      }
    });
  };
  const commitView = () => { setView(viewRef.current); };
  const commitSoon = () => {
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commitView, 140);
  };
  useEffect(() => { viewRef.current = view; applyLive(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downTarget = useRef<Element | null>(null);

  const svgPoint = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    // Le viewBox est ajusté en « meet » : même échelle sur les deux axes.
    const s = Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
    return [(clientX - r.left - ox) / s, (clientY - r.top - oy) / s];
  };
  const zoomAt = (factor: number, px: number, py: number, live = false) => {
    const v = viewRef.current;
    const k = Math.min(40, Math.max(0.8, v.k * factor));
    const f = k / v.k;
    const next = clampView({ k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f });
    if (live) { applyLive(next); commitSoon(); } else { viewRef.current = next; setView(next); }
  };
  // Molette et TRACKPAD (demande Antoine 07/09 : « dézoomer avec le pad
  // directement ») : écouteur natif non passif — React enregistre `wheel` en
  // passif, donc preventDefault n'agissait pas : le pincement zoomait la
  // PAGE et le défilement à deux doigts faisait défiler la page. Le pincement
  // arrive en wheel + ctrlKey avec de petits deltas : facteur renforcé.
  const zoomAtRef = useRef(zoomAt); zoomAtRef.current = zoomAt;
  const svgPointRef = useRef(svgPoint); svgPointRef.current = svgPoint;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = svgPointRef.current(e.clientX, e.clientY);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const gain = e.ctrlKey || e.metaKey ? 0.012 : 0.0015;
      zoomAtRef.current(Math.exp(-e.deltaY * unit * gain), px, py, true);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const [ax, ay] = svgPoint(a.x, a.y); const [bx, by] = svgPoint(b.x, b.y);
      pinch.current = { d: Math.hypot(bx - ax, by - ay), k: viewRef.current.k, cx: (ax + bx) / 2, cy: (ay + by) / 2 };
      drag.current = null;
      return;
    }
    const [px, py] = svgPoint(e.clientX, e.clientY);
    drag.current = { x: px, y: py, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
    downTarget.current = e.target as Element;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const [ax, ay] = svgPoint(a.x, a.y); const [bx, by] = svgPoint(b.x, b.y);
      const d = Math.hypot(bx - ax, by - ay);
      const k = Math.min(40, Math.max(0.8, pinch.current.k * (d / pinch.current.d)));
      const p = pinch.current;
      const v = viewRef.current; const f = k / v.k;
      applyLive(clampView({ k, tx: p.cx - (p.cx - v.tx) * f, ty: p.cy - (p.cy - v.ty) * f }));
      return;
    }
    if (!drag.current) return;
    const [px, py] = svgPoint(e.clientX, e.clientY);
    const d = drag.current;
    const dx = px - d.x, dy = py - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    // Valeurs capturées MAINTENANT : la mise à jour React s'exécute plus tard,
    // et si le pointeur est sorti du cadre entre-temps, drag.current est déjà
    // null (plantage « reading 'tx' », 07/09).
    applyLive(clampView({ ...viewRef.current, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const wasClick = drag.current && !drag.current.moved;
    drag.current = null;
    commitView(); // fin de geste : React reprend la main (regroupement, libellés)
    if (!wasClick) return;
    if (placing) {
      const [px, py] = svgPoint(e.clientX, e.clientY);
      const v = viewRef.current;
      const [lat, lng] = unproject((px - v.tx) / v.k, (py - v.ty) / v.k);
      void placeAt(lat, lng);
      return;
    }
    const t = downTarget.current;
    downTarget.current = null;
    if (!t) return;
    const pin = t.closest('[data-pin]');
    if (pin) { const c = contacts.find((x) => x.id === pin.getAttribute('data-pin')); if (c) selectContact(c); return; }
    const cl = t.closest('[data-cluster]');
    if (cl) {
      const x = Number(cl.getAttribute('data-x')), y = Number(cl.getAttribute('data-y'));
      centerOn(...unproject(x, y), Math.min(40, viewRef.current.k * 2.2));
      return;
    }
    const land = t.closest('[data-iso]');
    if (land) pickCountry(land.getAttribute('data-iso') || null);
  };
  const centerOn = (lat: number, lng: number, k?: number) => {
    const [x, y] = project(lat, lng);
    const kk = k ?? Math.max(viewRef.current.k, 4);
    const next = clampView({ k: kk, tx: W / 2 - x * kk, ty: H / 2 - y * kk });
    viewRef.current = next; setView(next);
  };

  const placingRef = useRef(placing); placingRef.current = placing;
  // Survol : pas de re-rendu pendant un glissement (la carte défile sous le curseur).
  const hoverCountryLive = useCallback((name: string | null) => { if (!drag.current) setHoverCountry(name); }, []);
  const pickCountry = useCallback((iso: string | null) => {
    if (!iso) return;
    setCountryFilter((f) => (f === iso ? null : iso));
  }, []);

  // ── Placement (clic sur la carte) ──
  const placeAt = async (lat: number, lng: number) => {
    const la = Math.round(lat * 1000) / 1000, ln = Math.round(lng * 1000) / 1000;
    if (placing === 'form' && editing) {
      setEditing({ ...editing, lat: la, lng: ln });
      setPlacing(null);
      return;
    }
    if (placing && placing !== 'form') {
      setBusy(true);
      const err = await moveContact(placing, la, ln);
      setBusy(false);
      setPlacing(null);
      if (err) setFlash(err); else { setFlash('Épingle déplacée.'); void reload(); }
    }
  };

  // ── Filtres ──
  const filtered = useMemo(() => contacts.filter((c) =>
    (roleFilter === 'tous' || c.role === roleFilter || c.role === 'les_deux')
    && (!countryFilter || c.country === countryFilter)
    && (!relationFilter || c.relation === relationFilter)
    && contactMatchesQuery(c, query)), [contacts, roleFilter, countryFilter, relationFilter, query]);
  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  const countries = useMemo(() => [...new Set(contacts.map((c) => c.country))].sort(), [contacts]);

  // ── Épingles et regroupement (dans l'espace écran → dépend du zoom) ──
  const pins = useMemo(() => filtered.map((c) => {
    const placed = c.lat != null && c.lng != null;
    const [lat, lng] = placed ? [c.lat!, c.lng!] : (COUNTRY_CENTROIDS[c.country] ?? [50, 10]);
    const [x, y] = project(lat, lng);
    return { c, x, y, placed };
  }), [filtered]);
  const clusters = useMemo(() => {
    const out: Array<{ x: number; y: number; items: typeof pins }> = [];
    const thr = 22 / view.k; // 22 unités écran
    for (const p of pins) {
      const hit = out.find((cl) => Math.hypot(cl.x - p.x, cl.y - p.y) < thr);
      if (hit) { hit.items.push(p); hit.x = (hit.x * (hit.items.length - 1) + p.x) / hit.items.length; hit.y = (hit.y * (hit.items.length - 1) + p.y) / hit.items.length; }
      else out.push({ x: p.x, y: p.y, items: [p] });
    }
    return out;
  }, [pins, view.k]);

  // ── Édition ──
  const startCreate = () => {
    setEditing(emptyInput(countryFilter ?? 'NL'));
    setEditModels([]);
    setSelectedId(null);
    setPanelOpen(true);
  };
  const startEdit = (c: NetworkContact) => {
    const { id, name, kind, role, country, city, lat, lng, contact_name, phone, email, website, relation, vehicle_types, monthly_volume, opportunity, margin, reliability, comment, notes, market_share, stock_total } = c;
    setEditing({ id, name, kind, role, country, city, lat, lng, contact_name, phone, email, website, relation, vehicle_types, monthly_volume, opportunity, margin, reliability, comment, notes, market_share, stock_total });
    setEditModels(c.models.map((m) => ({ brand: m.brand, model: m.model, qty: m.qty, note: m.note })));
    setPanelOpen(true);
  };
  const submit = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setFlash('Le nom est requis.'); return; }
    setBusy(true);
    let e = { ...editing, name: editing.name.trim(), country: editing.country.toUpperCase() };
    // Ville sans épingle → dictionnaire ; sinon centre du pays (« à placer »).
    if ((e.lat == null || e.lng == null) && e.city) {
      const hit = findCity(e.city, e.country);
      if (hit) e = { ...e, lat: hit.lat, lng: hit.lng };
    }
    const r = await saveContact(e, userId);
    if (r.error || !r.id) { setBusy(false); setFlash(r.error ?? 'Échec.'); return; }
    const err = await saveContactModels(r.id, editModels);
    setBusy(false);
    if (err) { setFlash(err); return; }
    setFlash('Enregistré.');
    setEditing(null);
    setSelectedId(r.id);
    void reload();
  };
  const remove = async (c: NetworkContact) => {
    if (!confirm(`Supprimer « ${c.name} » de la carte ?`)) return;
    setBusy(true);
    const err = await deleteContact(c.id);
    setBusy(false);
    if (err) setFlash(err); else { setFlash('Contact supprimé.'); setSelectedId(null); void reload(); }
  };
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }, [flash]);

  const selectContact = (c: NetworkContact) => {
    setSelectedId(c.id);
    setEditing(null);
    if (c.lat != null && c.lng != null) centerOn(c.lat, c.lng);
    else { const [la, ln] = COUNTRY_CENTROIDS[c.country] ?? [50, 10]; centerOn(la, ln, 3); }
  };

  // ── Rendu ──
  const stats = { total: contacts.length, acheteurs: contacts.filter((c) => c.role !== 'vendeur').length, vendeurs: contacts.filter((c) => c.role !== 'acheteur').length };
  return (
    <div className="-mx-6 -my-8 max-md:-mx-3 h-[calc(100vh-64px)] min-h-[560px] flex max-md:flex-col overflow-hidden bg-[#eef3f8]">
      {/* ── Carte ── */}
      <div className="relative flex-1 min-w-0 min-h-[320px] select-none">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={`w-full h-full touch-none ${placing ? 'cursor-crosshair' : drag.current ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <radialGradient id="sea" cx="50%" cy="40%" r="80%">
              <stop offset="0%" stopColor="#f4f8fc" />
              <stop offset="100%" stopColor="#d3dfec" />
            </radialGradient>
            <filter id="pinShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.35" />
            </filter>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="url(#sea)" />
          {/* Transformations écrites depuis viewRef (vue LIVE) : un re-rendu React
              en plein geste (survol d'un pays sous le curseur) ne ramène pas la
              carte à la dernière vue validée. */}
          <g ref={mapGRef} transform={`translate(${viewRef.current.tx} ${viewRef.current.ty}) scale(${viewRef.current.k})`} style={{ willChange: 'transform' }}>
            <LandLayer paths={countryPaths} activeIso={countryFilter} onHover={hoverCountryLive} />
            {/* Noms des pays du réseau */}
            {view.k >= 1.6 && NETWORK_COUNTRIES.map((iso) => {
              const [la, ln] = COUNTRY_CENTROIDS[iso];
              const [x, y] = project(la, ln);
              return (
                <text key={iso} x={x} y={y} textAnchor="middle" fontSize={11 / view.k} fill="#5b7390" fontWeight={600} letterSpacing={0.8 / view.k} style={{ pointerEvents: 'none', textTransform: 'uppercase' }}>
                  {COUNTRY_NAMES[iso] ?? iso}
                </text>
              );
            })}
          </g>
          {/* Épingles : couche ÉCRAN (hors du groupe transformé) — taille
              constante sans mise à l'échelle, déplacées directement par
              applyLive pendant un geste. */}
          <g ref={pinsGRef}>
            {clusters.map((cl, i) => {
              const single = cl.items.length === 1 ? cl.items[0] : null;
              const isSel = single ? single.c.id === selectedId : cl.items.some((p) => p.c.id === selectedId);
              const lv = viewRef.current;
              const sx = cl.x * lv.k + lv.tx, sy = cl.y * lv.k + lv.ty;
              if (!single) {
                const roles = new Set(cl.items.map((p) => p.c.role));
                const color = roles.size === 1 ? ROLE_COLOR[[...roles][0]] : '#475569';
                return (
                  <g key={`cl${i}`} data-x={cl.x} data-y={cl.y} data-cluster={i} transform={`translate(${sx} ${sy})`} className="cursor-pointer" filter="url(#pinShadow)">
                    <circle r={isSel ? 16 : 14} fill={color} stroke="#fff" strokeWidth={2.5} />
                    <text y={4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>{cl.items.length}</text>
                  </g>
                );
              }
              const c = single.c;
              const color = ROLE_COLOR[c.role];
              const rel = RELATION_COLOR[c.relation];
              return (
                <g key={c.id} data-x={single.x} data-y={single.y} data-pin={c.id} transform={`translate(${sx} ${sy})`} className="cursor-pointer">
                  {c.relation === 'chaud' && <circle r={isSel ? 20 : 16} fill={rel} opacity={0.18}><animate attributeName="r" values={`${isSel ? 16 : 12};${isSel ? 24 : 20};${isSel ? 16 : 12}`} dur="2.2s" repeatCount="indefinite" /></circle>}
                  {rel && <circle r={isSel ? 12.5 : 10.5} fill="none" stroke={rel} strokeWidth={2} opacity={0.9} />}
                  <g filter="url(#pinShadow)">
                    <circle r={isSel ? 9 : 7} fill={color} stroke="#fff" strokeWidth={2} strokeDasharray={single.placed ? undefined : '2 2'} opacity={single.placed ? 1 : 0.75} />
                  </g>
                  {(view.k >= 5 || isSel) && (
                    <text x={isSel ? 13 : 11} y={4} fontSize={11} fontWeight={600} fill="#1e293b" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{c.name}</text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Survol pays */}
        {hoverCountry && !placing && (
          <div className="absolute left-4 bottom-4 text-xs font-medium text-slate-600 bg-white/85 backdrop-blur rounded-full px-3 py-1 shadow-sm pointer-events-none">{hoverCountry}</div>
        )}
        {/* Mode placement */}
        {placing && (
          <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-sm font-medium text-white bg-brand-ocean rounded-full px-4 py-2 shadow-lg pointer-events-auto">
              <Crosshair className="w-4 h-4" /> Clique sur la carte pour poser l'épingle
              <button onClick={() => setPlacing(null)} className="ml-2 bg-white/20 hover:bg-white/30 rounded-full px-2 py-0.5 text-xs">Annuler</button>
            </div>
          </div>
        )}
        {/* Contrôles */}
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          {[
            { icon: ZoomIn, fn: () => zoomAt(1.6, W / 2, H / 2), t: 'Zoom avant' },
            { icon: ZoomOut, fn: () => zoomAt(1 / 1.6, W / 2, H / 2), t: 'Zoom arrière' },
            { icon: Maximize2, fn: () => { const v = fitView(); viewRef.current = v; setView(v); }, t: 'Toute l’Europe' },
          ].map(({ icon: I, fn, t }) => (
            <button key={t} title={t} onClick={fn} className="w-9 h-9 grid place-items-center bg-white/90 backdrop-blur rounded-lg shadow-sm border border-slate-200 text-slate-600 hover:text-brand-ocean hover:bg-white transition-colors"><I className="w-4 h-4" /></button>
          ))}
        </div>
        {/* Légende */}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5 text-[11px] text-slate-600 bg-white/85 backdrop-blur rounded-xl px-3 py-2 shadow-sm border border-slate-200">
          {(['vendeur', 'acheteur', 'les_deux'] as ContactRole[]).map((r) => (
            <button key={r} onClick={() => setRoleFilter((f) => (f === r ? 'tous' : r))} className={`flex items-center gap-2 rounded px-1 -mx-1 ${roleFilter === r ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'}`}>
              <span className="w-2.5 h-2.5 rounded-full border border-white shadow" style={{ background: ROLE_COLOR[r] }} /> {ROLE_LABEL[r]}
            </button>
          ))}
          <div className="border-t border-slate-200 my-0.5" />
          {RELATION_SUGGESTIONS.map((r) => (
            <button key={r} onClick={() => setRelationFilter((f) => (f === r ? null : r))} className={`flex items-center gap-2 rounded px-1 -mx-1 ${relationFilter === r ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'}`}>
              <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: RELATION_COLOR[r] }} /> {RELATION_LABEL[r]}
            </button>
          ))}
        </div>
        {/* Bouton panneau (mobile) */}
        <button onClick={() => setPanelOpen((o) => !o)} className="md:hidden absolute right-3 bottom-3 bg-white rounded-full shadow-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
          {panelOpen ? 'Masquer la liste' : `Contacts (${filtered.length})`}
        </button>
        {flash && <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none"><div className="text-sm text-white bg-slate-900/90 rounded-full px-4 py-2 shadow-lg">{flash}</div></div>}
        {loading && <div className="absolute inset-0 grid place-items-center pointer-events-none"><Loader2 className="w-6 h-6 text-brand-ocean animate-spin" /></div>}
      </div>

      {/* ── Panneau ── */}
      <aside className={`w-[400px] max-md:w-full max-md:h-[46vh] shrink-0 bg-white border-l max-md:border-l-0 max-md:border-t border-slate-200 flex flex-col ${panelOpen ? '' : 'max-md:hidden'}`}>
        {editing ? (
          <ContactForm value={editing} models={editModels} onChange={setEditing} onModels={setEditModels} onPlace={() => setPlacing('form')} onCancel={() => { setEditing(null); setPlacing(null); }} onSubmit={submit} busy={busy} />
        ) : selected ? (
          <ContactDetail c={selected} canEdit={canEdit} busy={busy} onClose={() => setSelectedId(null)} onEdit={() => startEdit(selected)} onMove={() => setPlacing(selected.id)} onDelete={() => remove(selected)} onFilterBrand={(b) => { setQuery(b); setSelectedId(null); }} />
        ) : (
          <>
            <div className="p-4 border-b border-slate-100 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-brand-ocean" />
                <h1 className="text-lg font-bold text-slate-900">Carte du réseau</h1>
                <span className="text-xs text-slate-400 ml-auto">{stats.total} contacts · {stats.vendeurs} vendeurs · {stats.acheteurs} acheteurs</span>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, ville, marque ou modèle (ex. Toyota, Elroq)…" className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40" />
                {query && <button onClick={() => setQuery('')} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {countries.map((iso) => (
                  <button key={iso} onClick={() => setCountryFilter((f) => (f === iso ? null : iso))} className={`text-xs rounded-full px-2 py-0.5 border transition-colors ${countryFilter === iso ? 'bg-brand-ocean text-white border-brand-ocean' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                    {FLAG[iso] ?? ''} {COUNTRY_NAMES[iso] ?? iso} <span className="opacity-60">{contacts.filter((c) => c.country === iso).length}</span>
                  </button>
                ))}
                {(countryFilter || relationFilter || roleFilter !== 'tous' || query) && (
                  <button onClick={() => { setCountryFilter(null); setRelationFilter(null); setRoleFilter('tous'); setQuery(''); }} className="text-xs text-slate-500 hover:text-slate-700 underline px-1">tout afficher</button>
                )}
              </div>
              {canEdit && (
                <button onClick={startCreate} className="w-full flex items-center justify-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> Ajouter un contact</button>
              )}
              {loadError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {filtered.length === 0 && !loading && <p className="text-sm text-slate-400 text-center py-10">Aucun contact ne correspond.</p>}
              {filtered.map((c) => (
                <button key={c.id} onClick={() => selectContact(c)} className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-white shadow" style={{ background: ROLE_COLOR[c.role] }} />
                    <span className="font-medium text-slate-900 truncate">{c.name}</span>
                    {c.relation && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 text-white shrink-0" style={{ background: RELATION_COLOR[c.relation] ?? '#64748b' }}>{RELATION_LABEL[c.relation] ?? c.relation}</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{FLAG[c.country] ?? ''} {c.city ?? <em className="text-amber-600 not-italic">à placer</em>}</span>
                    <span>·</span><span>{KIND_LABEL[c.kind]}</span>
                    {c.stock_total != null && <><span>·</span><span>{c.stock_total} en stock</span></>}
                  </div>
                  {c.models.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.models.slice(0, 5).map((m) => <span key={m.id} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{titleCase(m.brand)}{m.model ? ` ${titleCase(m.model)}` : ''}{m.qty != null ? ` · ${m.qty}` : ''}</span>)}
                      {c.models.length > 5 && <span className="text-[10px] text-slate-400">+{c.models.length - 5}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ── Couche des pays : FIGÉE (React.memo) — ne se re-rend qu'au changement du
// pays filtré ; survol en CSS, épaisseur de trait en pixels écran quel que
// soit le zoom (vector-effect), plus d'ombre portée GPU sur 250 Ko de tracés.
const LandLayer = memo(function LandLayer({ paths, activeIso, onHover }: {
  paths: Array<{ id: string; name: string; d: string; network: boolean }>;
  activeIso: string | null;
  onHover: (name: string | null) => void;
}) {
  return (
    <g
      onMouseOver={(e) => onHover((e.target as SVGElement).getAttribute('data-name'))}
      onMouseLeave={() => onHover(null)}
    >
      <style>{`.ada-land{transition:fill 120ms;stroke:#fff;stroke-width:0.8px;stroke-linejoin:round;vector-effect:non-scaling-stroke}.ada-land.net{fill:#dde9f6}.ada-land.net:hover{fill:#cfe0f3}.ada-land.oth{fill:#eceff3}.ada-land.oth:hover{fill:#e3e8ee}.ada-land.active{fill:#bcd3ec!important}`}</style>
      {paths.map((c) => {
        const iso = isoOf(c.name);
        return (
          <path key={c.id || c.name} d={c.d} data-name={c.name} data-iso={iso ?? ''}
            className={`ada-land ${c.network ? 'net' : 'oth'}${activeIso && iso === activeIso ? ' active' : ''}`} />
        );
      })}
    </g>
  );
});

// ── Détail ──────────────────────────────────────────────────────────────────
function ContactDetail({ c, canEdit, busy, onClose, onEdit, onMove, onDelete, onFilterBrand }: {
  c: NetworkContact; canEdit: boolean; busy: boolean; onClose: () => void; onEdit: () => void; onMove: () => void; onDelete: () => void; onFilterBrand: (b: string) => void;
}) {
  const rows: Array<[string, string]> = [
    ['Véhicules', c.vehicle_types], ['Volume mensuel', c.monthly_volume], ['Opportunité', c.opportunity],
    ['Marge potentielle', c.margin], ['Fiabilité', c.reliability],
  ].filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-start gap-2">
          <span className="w-3 h-3 mt-1.5 rounded-full shrink-0 border border-white shadow" style={{ background: ROLE_COLOR[c.role] }} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">{c.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{ROLE_LABEL[c.role]} · {KIND_LABEL[c.kind]} · {FLAG[c.country] ?? ''} {c.city ?? <span className="text-amber-600">à placer sur la carte</span>}{c.country ? `, ${COUNTRY_NAMES[c.country] ?? c.country}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {c.relation && <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-white" style={{ background: RELATION_COLOR[c.relation] ?? '#64748b' }}>{RELATION_LABEL[c.relation] ?? c.relation}</span>}
          {c.market_share != null && <span className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{c.market_share.toLocaleString('fr-FR')} % du panel</span>}
          {c.stock_total != null && <span className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">{c.stock_total} véhicules en stock</span>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        <div className="space-y-1.5">
          {c.contact_name && <p className="text-slate-800 font-medium">{c.contact_name}</p>}
          {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="flex items-center gap-2 text-brand-ocean hover:underline"><Phone className="w-4 h-4" /> {c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-brand-ocean hover:underline break-all"><Mail className="w-4 h-4 shrink-0" /> {c.email}</a>}
          {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-brand-ocean hover:underline"><ExternalLink className="w-4 h-4 shrink-0" /> Vitrine du stock</a>}
        </div>
        {rows.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows.map(([k, v]) => <><dt key={`${k}-k`} className="text-slate-400">{k}</dt><dd key={`${k}-v`} className="text-slate-700">{v}</dd></>)}
          </dl>
        )}
        {c.comment && <p className="text-slate-700 bg-slate-50 rounded-lg px-3 py-2 text-xs leading-relaxed">{c.comment}</p>}
        {c.notes && <p className="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap">{c.notes}</p>}
        {c.models.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><Car className="w-3.5 h-3.5" /> Marques et modèles</h3>
            <div className="space-y-0.5">
              {c.models.map((m) => (
                <button key={m.id} onClick={() => onFilterBrand(m.model ? `${m.brand} ${m.model}` : m.brand)} title="Qui d'autre suit cette marque ?" className="w-full flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-slate-50 text-left">
                  <span className="font-medium text-slate-800">{titleCase(m.brand)}{m.model ? ` ${titleCase(m.model)}` : ''}</span>
                  {m.note && <span className="text-slate-400 truncate">{m.note}</span>}
                  {m.qty != null && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="h-1.5 rounded-full bg-brand-ocean/70" style={{ width: `${Math.max(6, Math.min(60, m.qty * 3))}px` }} />
                      <span className="text-slate-600 tabular-nums w-6 text-right">{m.qty}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[10px] text-slate-400">Mis à jour le {new Date(c.updated_at).toLocaleDateString('fr-FR')}</p>
      </div>
      {canEdit && (
        <div className="p-3 border-t border-slate-100 flex gap-2">
          <button onClick={onEdit} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 bg-brand-ocean hover:bg-brand-encre text-white rounded-lg px-3 py-2 text-sm font-medium"><Pencil className="w-4 h-4" /> Modifier</button>
          <button onClick={onMove} disabled={busy} title="Déplacer l'épingle" className="flex items-center gap-1.5 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm"><Move className="w-4 h-4" /> Placer</button>
          <button onClick={onDelete} disabled={busy} title="Supprimer" className="flex items-center border border-slate-300 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 text-sm"><Trash2 className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}

// ── Formulaire ──────────────────────────────────────────────────────────────
function ContactForm({ value: v, models, onChange, onModels, onPlace, onCancel, onSubmit, busy }: {
  value: ContactInput; models: Array<{ brand: string; model: string; qty: number | null; note: string }>;
  onChange: (v: ContactInput) => void; onModels: (m: Array<{ brand: string; model: string; qty: number | null; note: string }>) => void;
  onPlace: () => void; onCancel: () => void; onSubmit: () => void; busy: boolean;
}) {
  const set = (patch: Partial<ContactInput>) => onChange({ ...v, ...patch });
  const [cityQ, setCityQ] = useState(v.city ?? '');
  const [cityOpen, setCityOpen] = useState(false);
  const suggestions = cityOpen ? findCities(cityQ, v.country) : [];
  const inp = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-ocean/40';
  const label = 'block text-[11px] font-medium text-slate-500 mb-1';
  const countryOptions = [...NETWORK_COUNTRIES, ...Object.keys(COUNTRY_NAMES).filter((k) => !NETWORK_COUNTRIES.includes(k))];
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900">{v.id ? 'Modifier le contact' : 'Nouveau contact'}</h2>
        <button onClick={onCancel} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <label className={label}>Société *</label>
          <input value={v.name} onChange={(e) => set({ name: e.target.value })} required className={inp} placeholder="Van Mossel" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Rôle</label>
            <select value={v.role} onChange={(e) => set({ role: e.target.value as ContactRole })} className={inp}>
              {(Object.keys(ROLE_LABEL) as ContactRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Type</label>
            <select value={v.kind} onChange={(e) => set({ kind: e.target.value as ContactKind })} className={inp}>
              {(Object.keys(KIND_LABEL) as ContactKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-[110px_1fr] gap-2">
          <div>
            <label className={label}>Pays</label>
            <select value={v.country} onChange={(e) => set({ country: e.target.value })} className={inp}>
              {countryOptions.map((k) => <option key={k} value={k}>{FLAG[k] ?? ''} {COUNTRY_NAMES[k] ?? k}</option>)}
            </select>
          </div>
          <div className="relative">
            <label className={label}>Ville</label>
            <input
              value={cityQ}
              onChange={(e) => { setCityQ(e.target.value); setCityOpen(true); set({ city: e.target.value, lat: null, lng: null }); }}
              onFocus={() => setCityOpen(true)}
              onBlur={() => setTimeout(() => setCityOpen(false), 150)}
              className={inp} placeholder="Amsterdam" autoComplete="off"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((c) => (
                  <li key={`${c.country}-${c.name}`}>
                    <button type="button" onMouseDown={() => { setCityQ(c.name); setCityOpen(false); set({ city: c.name, country: c.country, lat: c.lat, lng: c.lng }); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                      {FLAG[c.country] ?? ''} {c.name} <span className="text-xs text-slate-400">{COUNTRY_NAMES[c.country] ?? c.country}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {v.lat != null && v.lng != null
            ? <span className="flex items-center gap-1 text-emerald-700"><Check className="w-3.5 h-3.5" /> Épingle posée ({v.lat.toFixed(3)}, {v.lng.toFixed(3)})</span>
            : <span className="text-amber-700">Sans épingle : {v.city ? 'ville inconnue du dictionnaire, ' : ''}elle ira au centre du pays.</span>}
          <button type="button" onClick={onPlace} className="ml-auto flex items-center gap-1 text-brand-ocean hover:underline"><Crosshair className="w-3.5 h-3.5" /> Poser sur la carte</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Contact</label><input value={v.contact_name ?? ''} onChange={(e) => set({ contact_name: e.target.value })} className={inp} placeholder="Prénom Nom" /></div>
          <div><label className={label}>Téléphone / WhatsApp</label><input value={v.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} className={inp} placeholder="+31 …" /></div>
        </div>
        <div><label className={label}>Email</label><input type="email" value={v.email ?? ''} onChange={(e) => set({ email: e.target.value })} className={inp} /></div>
        <div><label className={label}>Vitrine (URL du stock)</label><input value={v.website ?? ''} onChange={(e) => set({ website: e.target.value })} className={inp} placeholder="https://…" /></div>
        <div>
          <label className={label}>Relation</label>
          <div className="flex flex-wrap gap-1.5">
            {RELATION_SUGGESTIONS.map((r) => (
              <button type="button" key={r} onClick={() => set({ relation: v.relation === r ? '' : r })} className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${v.relation === r ? 'text-white border-transparent' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`} style={v.relation === r ? { background: RELATION_COLOR[r] } : undefined}>{RELATION_LABEL[r]}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Type de véhicules</label><input value={v.vehicle_types} onChange={(e) => set({ vehicle_types: e.target.value })} className={inp} placeholder="Hybrids / EV / LCV" /></div>
          <div><label className={label}>Volume mensuel estimé</label><input value={v.monthly_volume} onChange={(e) => set({ monthly_volume: e.target.value })} className={inp} /></div>
          <div><label className={label}>Type d'opportunité</label><input value={v.opportunity} onChange={(e) => set({ opportunity: e.target.value })} className={inp} placeholder="Units / batch" /></div>
          <div><label className={label}>Marge potentielle</label><input value={v.margin} onChange={(e) => set({ margin: e.target.value })} className={inp} /></div>
          <div><label className={label}>Fiabilité</label><input value={v.reliability} onChange={(e) => set({ reliability: e.target.value })} className={inp} /></div>
          <div><label className={label}>Stock total</label><input type="number" value={v.stock_total ?? ''} onChange={(e) => set({ stock_total: e.target.value === '' ? null : Number(e.target.value) })} className={inp} /></div>
        </div>
        <div><label className={label}>Commentaire</label><textarea value={v.comment} onChange={(e) => set({ comment: e.target.value })} className={`${inp} min-h-[60px]`} /></div>
        <div><label className={label}>Notes</label><textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} className={`${inp} min-h-[60px]`} /></div>
        <div>
          <label className={label}>Marques et modèles suivis <span className="text-slate-400 font-normal">(quantité en stock ou intérêt)</span></label>
          <div className="space-y-1.5">
            {models.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_56px_1fr_auto] gap-1">
                <input value={m.brand} onChange={(e) => onModels(models.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)))} placeholder="Marque" className={`${inp} px-2 py-1 text-xs`} />
                <input value={m.model} onChange={(e) => onModels(models.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} placeholder="Modèle" className={`${inp} px-2 py-1 text-xs`} />
                <input type="number" value={m.qty ?? ''} onChange={(e) => onModels(models.map((x, j) => (j === i ? { ...x, qty: e.target.value === '' ? null : Number(e.target.value) } : x)))} placeholder="Qté" className={`${inp} px-2 py-1 text-xs`} />
                <input value={m.note} onChange={(e) => onModels(models.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder="Note" className={`${inp} px-2 py-1 text-xs`} />
                <button type="button" onClick={() => onModels(models.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 px-1"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => onModels([...models, { brand: '', model: '', qty: null, note: '' }])} className="text-xs text-brand-ocean hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Ajouter une marque / un modèle</button>
          </div>
        </div>
      </form>
      <div className="p-3 border-t border-slate-100 flex gap-2">
        <button onClick={onSubmit} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 bg-brand-ocean hover:bg-brand-encre disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer</button>
        <button onClick={onCancel} disabled={busy} className="border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm">Annuler</button>
      </div>
    </div>
  );
}

// ── Utilitaires ─────────────────────────────────────────────────────────────
/** Emprise projetée de la géométrie (boîte de découpe de l'extraction :
 *  -32…62° E, 27…75° N), échantillonnée sur son contour. */
const MAP_BBOX = (() => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const take = (lat: number, lng: number) => { const [x, y] = project(lat, lng); x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  for (let lng = -32; lng <= 62; lng += 2) { take(27, lng); take(75, lng); }
  for (let lat = 27; lat <= 75; lat += 2) { take(lat, -32); take(lat, 62); }
  return { x1, y1, x2, y2 };
})();

/** La carte reste toujours visible : l'ÉCRAN doit garder au moins une bande
 *  de 120 unités de carte — n'importe où sur la carte, pas un point fixe
 *  (première version : le cœur de l'Allemagne devait rester à l'écran, et
 *  zoomer sur les Pays-Bas repoussait la vue vers l'Allemagne « comme au
 *  bord de quelque chose », constat Channing 08/09). Valeur non finie
 *  (zoom extrême) → vue initiale. */
function clampView(v: View): View {
  if (![v.k, v.tx, v.ty].every(Number.isFinite)) return fitView();
  const m = 120;
  // Bords de la carte à l'écran.
  const left = MAP_BBOX.x1 * v.k + v.tx, right = MAP_BBOX.x2 * v.k + v.tx;
  const top = MAP_BBOX.y1 * v.k + v.ty, bottom = MAP_BBOX.y2 * v.k + v.ty;
  let { tx, ty } = v;
  if (right < m) tx += m - right;          // la carte est partie trop à gauche
  else if (left > W - m) tx -= left - (W - m); // trop à droite
  if (bottom < m) ty += m - bottom;        // trop haut
  else if (top > H - m) ty -= top - (H - m);   // trop bas
  return { k: v.k, tx, ty };
}

function fitView(): View {
  // Cadre initial : Europe de l'Ouest et du Nord (les 10 pays du réseau).
  const [x1, y1] = project(66, -10), [x2, y2] = project(36, 28);
  const k = Math.min(W / Math.abs(x2 - x1), H / Math.abs(y2 - y1)) * 0.92;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return { k, tx: W / 2 - cx * k, ty: H / 2 - cy * k };
}
const ISO_BY_NAME: Record<string, string> = {
  France: 'FR', Netherlands: 'NL', Belgium: 'BE', Germany: 'DE', Denmark: 'DK', Sweden: 'SE', Italy: 'IT', Spain: 'ES', Hungary: 'HU', Lithuania: 'LT',
  Luxembourg: 'LU', Austria: 'AT', Switzerland: 'CH', Poland: 'PL', Czechia: 'CZ', Portugal: 'PT', Norway: 'NO', Finland: 'FI', Ireland: 'IE',
  'United Kingdom': 'GB', Estonia: 'EE', Latvia: 'LV', Romania: 'RO', Slovakia: 'SK', Slovenia: 'SI', Croatia: 'HR', Bulgaria: 'BG', Greece: 'GR',
  Serbia: 'RS', Morocco: 'MA', Turkey: 'TR', Ukraine: 'UA',
};
const isoOf = (name: string): string | null => ISO_BY_NAME[name] ?? null;
const isNetworkCountry = (name: string): boolean => { const iso = isoOf(name); return Boolean(iso && NETWORK_COUNTRIES.includes(iso)); };
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()).replace(/\bBmw\b/g, 'BMW').replace(/\bMg\b/g, 'MG').replace(/\bByd\b/g, 'BYD').replace(/\bVw\b/g, 'VW');
// Le dictionnaire de villes est exporté pour les tests de placement.
export const CITY_COUNT = CITIES.length;
