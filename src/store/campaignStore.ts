import { create } from 'zustand';
import type { CampaignPlanItem } from '../lib/linkgen/campaignPlanner';

export type CampaignOutcome =
  | 'confirmed' | 'taxonomy_gap' | 'enum_gap' | 'no_url' | 'insufficient' | 'technical';

export interface CampaignItemResult {
  seq: number;
  site: string;
  brand: string;
  model: string;
  fuel?: string;
  trim?: string;
  kind: CampaignPlanItem['kind'];
  url: string | null;
  outcome: CampaignOutcome;
  confirmedFields: string[];
  rejected: Array<{ field: string; declared: string; reason: string }>;
  detail: string;
  sampleSize: number;
}

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
  /** Set by the stop button; the runner checks it between (and during) items. */
  stopRequested: boolean;
}

/**
 * Module-level singleton — the campaign loop lives OUTSIDE React, so page /
 * tab navigation inside ADA never interrupts it. Only closing the browser
 * stops a run (items already persisted in DB survive even that).
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
