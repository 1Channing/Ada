import { create } from 'zustand';
import type { CampaignItemResult as EngineItemResult } from '../lib/linkgen/campaignEngine';

// Single source of truth for these types is the shared engine — the store
// re-exports them so UI code keeps importing from here.
export type { CampaignOutcome } from '../lib/linkgen/campaignEngine';
export type CampaignItemResult = EngineItemResult & {
  /** Set when the gap was manually marked fixed (Marquer corrigé). */
  resolvedAt?: string | null;
};

export type CampaignStatus = 'idle' | 'planning' | 'running' | 'stopping' | 'stopped' | 'done' | 'error';

export interface CampaignCounts {
  confirmed: number;
  taxonomy_gap: number;
  enum_gap: number;
  no_url: number;
  insufficient: number;
  technical: number;
}

export const EMPTY_COUNTS: CampaignCounts = {
  confirmed: 0, taxonomy_gap: 0, enum_gap: 0, no_url: 0, insufficient: 0, technical: 0,
};

interface CampaignState {
  campaignId: string | null;
  status: CampaignStatus;
  total: number;
  done: number;
  counts: CampaignCounts;
  current: { seq: number; site: string; brand: string; model: string; reason: string } | null;
  /** All finished item results of the campaign being viewed (live or loaded). */
  items: CampaignItemResult[];
  error: string | null;
  /** UI hint while a stop request is propagating to the worker. */
  stopRequested: boolean;
}

/**
 * View-model of the campaign DB state. The loop itself runs in the Railway
 * worker (browser closed included); the watcher (services/campaignRunner)
 * keeps this store mirroring the campaign row + items.
 */
export const useCampaignStore = create<CampaignState>(() => ({
  campaignId: null,
  status: 'idle',
  total: 0,
  done: 0,
  counts: { ...EMPTY_COUNTS },
  current: null,
  items: [],
  error: null,
  stopRequested: false,
}));
