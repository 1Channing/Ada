export type PricingContext = {
  targetExportPrice: number;
  transportCostEstimate?: number;
  safetyMargin?: number;
};

export function computeEstimatedMarginEur(
  listingPrice: number,
  ctx: PricingContext
): number {
  const transport = ctx.transportCostEstimate ?? 500;
  const safety = ctx.safetyMargin ?? 0;
  return ctx.targetExportPrice - listingPrice - transport - safety;
}

export function computeScoreMc(marginEur: number): number {
  const rawScore = marginEur / 1000;
  return Math.max(0, Math.min(15, rawScore));
}

export function computeDaysOnline(
  firstSeenAt: Date | string,
  lastSeenAt: Date | string
): number {
  const first = typeof firstSeenAt === 'string' ? new Date(firstSeenAt) : firstSeenAt;
  const last = typeof lastSeenAt === 'string' ? new Date(lastSeenAt) : lastSeenAt;

  const diffMs = last.getTime() - first.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

export type ListingStatus =
  | 'new'
  | 'seen'
  | 'disappeared'
  | 'price_up'
  | 'price_down'
  | 'contacted'
  | 'bought'
  | 'rejected';

export function deriveStatus(
  previousPrice: number | null,
  currentPrice: number,
  existsToday: boolean,
  previousStatus: ListingStatus = 'new'
): ListingStatus {
  if (!existsToday) {
    return 'disappeared';
  }

  if (previousPrice === null) {
    return 'new';
  }

  if (['contacted', 'bought', 'rejected'].includes(previousStatus)) {
    return previousStatus;
  }

  if (currentPrice > previousPrice) {
    return 'price_up';
  }

  if (currentPrice < previousPrice) {
    return 'price_down';
  }

  return previousStatus === 'new' ? 'seen' : previousStatus;
}

export function safeParseInt(value: unknown, defaultValue: number = 0): number {
  if (typeof value === 'number') {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = parseInt(value.replace(/\D/g, ''), 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  return defaultValue;
}

export function safeParseFloat(value: unknown, defaultValue: number = 0): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  return defaultValue;
}

export type PricingStrategy = 'mean_5_lowest' | 'median_minus_5pct' | 'mean_all' | 'median';

export function computeTargetPrice(
  prices: number[],
  strategy: PricingStrategy = 'mean_5_lowest'
): number {
  if (prices.length === 0) {
    return 0;
  }

  const sorted = [...prices].sort((a, b) => a - b);

  switch (strategy) {
    case 'mean_5_lowest': {
      const lowest5 = sorted.slice(0, Math.min(5, sorted.length));
      const sum = lowest5.reduce((acc, p) => acc + p, 0);
      return sum / lowest5.length;
    }

    case 'median_minus_5pct': {
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      return median * 0.95;
    }

    case 'mean_all': {
      const sum = sorted.reduce((acc, p) => acc + p, 0);
      return sum / sorted.length;
    }

    case 'median': {
      return sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    }

    default:
      return 0;
  }
}

export function adjustScoreWithAI(
  baseScore: number,
  aiAdjustment: number
): number {
  const adjusted = baseScore + aiAdjustment;
  return Math.max(0, Math.min(15, adjusted));
}
