import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode, MappingStatus } from '../services/ingestionHistory';

const STATUS_COLOR: Record<MappingStatus, string> = {
  valid: '#10b981',   // emerald — human_verified valid
  partial: '#f59e0b', // amber
  csv: '#64748b',     // slate — csv_import
  pending: '#71717a', // zinc
  invalid: '#ef4444', // red
  group: '#3f3f46',   // zinc-700 — structural node
};

const STATUS_LABEL: Record<MappingStatus, string> = {
  valid: 'Certifié (human)',
  partial: 'Partiel',
  csv: 'CSV importé',
  pending: 'En attente',
  invalid: 'Invalide',
  group: 'Regroupement',
};

// Mappings confirmed by Ada's campaigns with no human confirmation yet.
const ADA_COLOR = '#a78bfa'; // violet-400
const ADA_LABEL = 'Appris par Ada seule';

const RING = 120;

interface Positioned {
  node: TreeNode;
  x: number;
  y: number;
  angle: number;
  radius: number;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  /** Arc length (px) of the angular slot this node owns on its ring. */
  arc: number;
}

function nodeRadius(weight: number): number {
  return Math.max(4, Math.min(14, 4 + Math.log2(weight + 1) * 2.2));
}

export function MappingRadialTree({ root }: { root: TreeNode }) {
  // Default: EVERYTHING expanded — the full site → marque → modèle → finition
  // map at a glance ("Tout replier" remains one click away).
  const defaultExpanded = useMemo(() => new Set<string>(collectAllIds(root)), [root]);

  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);
  const [hovered, setHovered] = useState<Positioned | null>(null);

  // STRUCTURAL zoom: the wheel scales the ring SPACING (nodes spread apart),
  // while dot sizes and text stay constant — not a CSS magnifier where
  // everything grows and labels stay glued together.
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Cursor-anchored zoom. The re-layout grows the SVG from its corner, which
  // made zooming drift towards the top-left: we capture the point under the
  // cursor BEFORE the zoom, then (after React re-renders with the new size)
  // scroll so that same world point sits back under the cursor. Node
  // positions scale exactly by newZoom/oldZoom (radius ∝ zoom), the root
  // staying at the SVG centre. +/− buttons anchor to the viewport centre.
  const sizeRef = useRef(0);
  const pendingAnchorRef = useRef<{ offsetX: number; offsetY: number; scrollLeft: number; scrollTop: number; oldSize: number; ratio: number } | null>(null);
  const applyZoom = (factor: number, clientX?: number, clientY?: number) => {
    const el = containerRef.current;
    setZoom((z) => {
      const nz = Math.min(8, Math.max(0.5, z * factor));
      if (el && nz !== z) {
        const rect = el.getBoundingClientRect();
        pendingAnchorRef.current = {
          offsetX: clientX != null ? clientX - rect.left : el.clientWidth / 2,
          offsetY: clientY != null ? clientY - rect.top : el.clientHeight / 2,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
          oldSize: sizeRef.current,
          ratio: nz / z,
        };
      }
      return nz;
    });
  };
  const applyZoomRef = useRef(applyZoom);
  applyZoomRef.current = applyZoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoomRef.current(e.deltaY < 0 ? 1.12 : 0.9, e.clientX, e.clientY);
    };
    // React's onWheel is passive — preventDefault needs a non-passive listener.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Click-and-drag panning (the wheel being taken by zoom). A real drag
  // (> 4 px) must NOT count as a node click — didDragRef suppresses the
  // expand/collapse toggle that would otherwise fire on pointer release.
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const didDragRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
    didDragRef.current = false;
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = containerRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; didDragRef.current = true; }
    if (d.moved) {
      el.scrollLeft = d.sl - dx;
      el.scrollTop = d.st - dy;
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setPanning(false);
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { positioned, links, maxRadius } = useMemo(() => {
    const positioned: Positioned[] = [];
    const links: Array<{ from: Positioned; to: Positioned }> = [];
    const byId = new Map<string, Positioned>();

    const countLeaves = (n: TreeNode): number => {
      const showChildren = expanded.has(n.id) && n.children.length > 0;
      if (!showChildren) return 1;
      return n.children.reduce((s, c) => s + countLeaves(c), 0);
    };
    const totalLeaves = Math.max(1, countLeaves(root));

    let leafIndex = 0;
    let maxRadius = 0;

    const assign = (n: TreeNode, depth: number, parentId: string | null): number => {
      const hasChildren = n.children.length > 0;
      const isExpanded = expanded.has(n.id);
      const showChildren = isExpanded && hasChildren;
      const radius = depth * RING * zoom;
      maxRadius = Math.max(maxRadius, radius);

      const startLeaf = leafIndex;
      let angle: number;
      if (!showChildren) {
        angle = ((leafIndex + 0.5) / totalLeaves) * Math.PI * 2;
        leafIndex += 1;
      } else {
        const childAngles = n.children.map((c) => assign(c, depth + 1, n.id));
        angle = (Math.min(...childAngles) + Math.max(...childAngles)) / 2;
      }
      const leaves = Math.max(1, leafIndex - startLeaf);

      const p: Positioned = {
        node: n,
        angle,
        radius,
        depth,
        hasChildren,
        expanded: isExpanded,
        parentId,
        x: Math.cos(angle - Math.PI / 2) * radius,
        y: Math.sin(angle - Math.PI / 2) * radius,
        arc: (leaves / totalLeaves) * Math.PI * 2 * radius,
      };
      positioned.push(p);
      byId.set(n.id, p);
      return angle;
    };

    assign(root, 0, null);
    for (const p of positioned) {
      if (p.parentId) {
        const parent = byId.get(p.parentId);
        if (parent) links.push({ from: parent, to: p });
      }
    }
    return { positioned, links, maxRadius };
  }, [root, expanded, zoom]);

  const pad = 140;
  const size = (maxRadius + pad) * 2;
  sizeRef.current = size;

  // After the re-layout, put the captured world point back under the cursor.
  useLayoutEffect(() => {
    const a = pendingAnchorRef.current;
    const el = containerRef.current;
    if (!a || !el) return;
    pendingAnchorRef.current = null;
    // World coords of the anchored point (origin = tree centre), then its new
    // position after the radial scale, then the scroll that re-aligns it.
    const wx = a.scrollLeft + a.offsetX - a.oldSize / 2;
    const wy = a.scrollTop + a.offsetY - a.oldSize / 2;
    el.scrollLeft = Math.max(0, wx * a.ratio + size / 2 - a.offsetX);
    el.scrollTop = Math.max(0, wy * a.ratio + size / 2 - a.offsetY);
  }, [size, zoom]);

  // Zoomed out, the rings tighten: shrink the dots and fade the spokes so
  // the overview stays legible instead of a solid tangle.
  const dotScale = Math.min(1, Math.max(0.5, zoom));
  const linkOpacity = Math.min(1, 0.3 + zoom * 0.7);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <button
          onClick={() => setExpanded(new Set(collectAllIds(root)))}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >Tout déplier</button>
        <button
          onClick={() => setExpanded(new Set([root.id]))}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >Tout replier</button>
        <span className="text-zinc-600">·</span>
        <button onClick={() => applyZoom(0.9)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">−</button>
        <span className="text-zinc-500 tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => applyZoom(1.12)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">+</button>
        <span className="text-zinc-600">·</span>
        {(['valid', 'partial', 'csv', 'pending'] as MappingStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1 text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: ADA_COLOR }} />
          {ADA_LABEL}
        </span>
        <span className="text-zinc-600 ml-auto">Molette = espacer · glisser = se déplacer · clic = déplier / replier</span>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`relative overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ maxHeight: 620 }}
      >
        <svg
          viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
          width={size}
          height={size}
          style={{ maxWidth: 'none' }}
        >
          {links.map((l, i) => (
            <line
              key={i}
              x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y}
              stroke="#3f3f46" strokeWidth={1} opacity={linkOpacity}
            />
          ))}
          {positioned.map((p) => {
            const rightHalf = Math.cos(p.angle - Math.PI / 2) >= 0;
            const isRoot = p.depth === 0;
            const r = (isRoot ? 7 : nodeRadius(p.node.weight)) * (isRoot ? 1 : dotScale);
            const fontSize = isRoot ? 13 : Math.max(8, 12 - p.depth);
            // Level of detail: a label only renders when its angular slot
            // leaves it room to breathe — dense rings stay clean dots and the
            // labels reappear as the zoom spreads them apart (hover always
            // shows the name). Sites (depth 1) are few and always labelled.
            const showLabel = isRoot || p.depth === 1 || p.arc >= fontSize;
            return (
              <g
                key={p.node.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => { if (didDragRef.current) return; if (p.hasChildren) toggle(p.node.id); }}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: p.hasChildren ? 'pointer' : 'default' }}
              >
                <circle
                  r={r}
                  fill={p.node.adaOnly ? ADA_COLOR : STATUS_COLOR[p.node.status]}
                  stroke={p.hasChildren && !p.expanded ? '#e4e4e7' : '#18181b'}
                  strokeWidth={p.hasChildren && !p.expanded ? 1.5 : 1}
                />
                {showLabel && (
                  <text
                    x={rightHalf ? r + 4 : -(r + 4)}
                    y={4}
                    textAnchor={rightHalf ? 'start' : 'end'}
                    fontSize={fontSize}
                    fill={isRoot ? '#f4f4f5' : p.depth >= 4 ? '#8b8b93' : '#a1a1aa'}
                    fontWeight={p.depth <= 1 ? 600 : 400}
                  >
                    {p.node.label}
                    {p.hasChildren && !p.expanded ? ` (${p.node.children.length})` : ''}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute top-2 left-2 bg-zinc-900/95 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 shadow-lg">
            <div className="font-medium">{hovered.node.label}</div>
            <div className="text-zinc-500">
              {hovered.node.adaOnly ? ADA_LABEL : STATUS_LABEL[hovered.node.status]}
            </div>
            {hovered.node.meta && Object.entries(hovered.node.meta).map(([k, v]) => (
              <div key={k} className="text-zinc-400">{k}: {String(v)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function collectAllIds(n: TreeNode, acc: string[] = []): string[] {
  acc.push(n.id);
  n.children.forEach((c) => collectAllIds(c, acc));
  return acc;
}
