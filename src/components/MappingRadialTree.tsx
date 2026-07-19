import { useMemo, useState } from 'react';
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
      const radius = depth * RING;
      maxRadius = Math.max(maxRadius, radius);

      let angle: number;
      if (!showChildren) {
        angle = ((leafIndex + 0.5) / totalLeaves) * Math.PI * 2;
        leafIndex += 1;
      } else {
        const childAngles = n.children.map((c) => assign(c, depth + 1, n.id));
        angle = (Math.min(...childAngles) + Math.max(...childAngles)) / 2;
      }

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
  }, [root, expanded]);

  const pad = 140;
  const size = (maxRadius + pad) * 2;

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
        <span className="text-zinc-600 ml-auto">Clique un nœud pour déplier / replier</span>
      </div>

      <div className="relative overflow-auto rounded-xl border border-zinc-800 bg-zinc-950" style={{ maxHeight: 620 }}>
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
              stroke="#3f3f46" strokeWidth={1}
            />
          ))}
          {positioned.map((p) => {
            const rightHalf = Math.cos(p.angle - Math.PI / 2) >= 0;
            const isRoot = p.depth === 0;
            const r = isRoot ? 7 : nodeRadius(p.node.weight);
            return (
              <g
                key={p.node.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => p.hasChildren && toggle(p.node.id)}
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
                {/* Labels at every depth — the variant ring (fuel/finition,
                    depth 4) was left unlabelled and looked like anonymous dots. */}
                <text
                  x={rightHalf ? r + 4 : -(r + 4)}
                  y={4}
                  textAnchor={rightHalf ? 'start' : 'end'}
                  fontSize={isRoot ? 13 : Math.max(8, 12 - p.depth)}
                  fill={isRoot ? '#f4f4f5' : p.depth >= 4 ? '#8b8b93' : '#a1a1aa'}
                  fontWeight={p.depth <= 1 ? 600 : 400}
                >
                  {p.node.label}
                  {p.hasChildren && !p.expanded ? ` (${p.node.children.length})` : ''}
                </text>
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
