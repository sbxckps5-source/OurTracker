// Multi-API Currency Conversion Service
// Uses all available free and public FX APIs in cascade with redundancy

interface CachedRate {
  rate: number;
  provider: string;
  timestamp: number;
}

const fxCache = new Map<string, CachedRate>();
const FX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

export interface FxResult {
  from: string;
  to: string;
  rate: number;
  provider: string;
  timestamp: number;
}

// 1. Frankfurter (European Central Bank)
async function fetchFromFrankfurter(from: string, to: string): Promise<number> {
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Frankfurter error ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (typeof rate === 'number') return rate;
  throw new Error('Invalid rate from Frankfurter');
}

// 2. Open Exchange Rates (open.er-api.com)
async function fetchFromOpenErApi(from: string, to: string): Promise<number> {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`OpenErApi error ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (typeof rate === 'number') return rate;
  throw new Error('Invalid rate from OpenErApi');
}

// 3. Fawaz Ahmed Open Currency API (JSDelivr CDN)
async function fetchFromJsDelivr(from: string, to: string): Promise<number> {
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`JsDelivr Currency error ${res.status}`);
  const data = await res.json();
  const baseObj = data?.[from.toLowerCase()];
  const rate = baseObj?.[to.toLowerCase()];
  if (typeof rate === 'number') return rate;
  throw new Error('Invalid rate from JsDelivr');
}

// 4. Yahoo Finance FX
async function fetchFromYahooFx(from: string, to: string): Promise<number> {
  const pair = `${from}${to}=X`;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Yahoo FX error ${res.status}`);
  const json = await res.json();
  const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price === 'number') return price;
  throw new Error('Invalid rate from Yahoo FX');
}

/**
 * Get conversion rate from one currency to another using all available APIs in cascade
 */
export async function getExchangeRate(from: string, to: string = 'EUR'): Promise<FxResult> {
  const cleanFrom = from.trim().toUpperCase();
  const cleanTo = to.trim().toUpperCase();

  if (cleanFrom === cleanTo) {
    return {
      from: cleanFrom,
      to: cleanTo,
      rate: 1.0,
      provider: 'Direct (1:1)',
      timestamp: Date.now(),
    };
  }

  // Handle pence (GBp) to EUR
  const isPence = cleanFrom === 'GBP' && from === 'GBp';
  const effectiveFrom = isPence ? 'GBP' : cleanFrom;

  const cacheKey = `${effectiveFrom}_${cleanTo}`;
  const cached = fxCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FX_CACHE_TTL) {
    return {
      from: cleanFrom,
      to: cleanTo,
      rate: isPence ? cached.rate / 100 : cached.rate,
      provider: `${cached.provider} (cached)`,
      timestamp: cached.timestamp,
    };
  }

  const providers = [
    { name: 'Frankfurter (Banco Central Europeu)', fn: () => fetchFromFrankfurter(effectiveFrom, cleanTo) },
    { name: 'Open Exchange Rates (open.er-api)', fn: () => fetchFromOpenErApi(effectiveFrom, cleanTo) },
    { name: 'JSDelivr Currency Global API', fn: () => fetchFromJsDelivr(effectiveFrom, cleanTo) },
    { name: 'Yahoo Finance FX', fn: () => fetchFromYahooFx(effectiveFrom, cleanTo) },
  ];

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const rate = await provider.fn();
      if (rate && rate > 0) {
        fxCache.set(cacheKey, { rate, provider: provider.name, timestamp: Date.now() });
        return {
          from: cleanFrom,
          to: cleanTo,
          rate: isPence ? rate / 100 : rate,
          provider: provider.name,
          timestamp: Date.now(),
        };
      }
    } catch (err: any) {
      lastError = err;
      // Continue to next provider in cascade
    }
  }

  // Fallback fallback approximate rates if offline or completely unreachable
  const staticFallback: Record<string, number> = {
    USD: 0.86,
    GBP: 1.16,
    CHF: 1.05,
    JPY: 0.006,
    CAD: 0.63,
    AUD: 0.56,
  };

  const fallbackRate = staticFallback[effectiveFrom] || 1.0;
  return {
    from: cleanFrom,
    to: cleanTo,
    rate: isPence ? fallbackRate / 100 : fallbackRate,
    provider: 'Taxa de Referência (Fallback)',
    timestamp: Date.now(),
  };
}

/**
 * Batch convert an amount
 */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string = 'EUR'
): Promise<{ originalAmount: number; convertedAmount: number; rate: number; provider: string }> {
  const fx = await getExchangeRate(from, to);
  return {
    originalAmount: amount,
    convertedAmount: Number((amount * fx.rate).toFixed(2)),
    rate: fx.rate,
    provider: fx.provider,
  };
}
