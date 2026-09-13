import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getExchangeRate, convertCurrency } from './serverFx';
import { parsePortfolioPdf } from './serverPdf';

interface CachedData<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CachedData<any>>();
const CACHE_TTL_MS = 20 * 1000; // 20 seconds cache for responsive 30s auto-refresh
const QUOTE_SUMMARY_TTL_MS = 15 * 60 * 1000; // 15 minutes cache for fundamental metrics

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

const CHART_RANGE_CONFIG: Record<string, { range: string; interval: string }> = {
  '1d': { range: '1d', interval: '2m' },
  '1w': { range: '5d', interval: '15m' },
  '1m': { range: '1mo', interval: '30m' },
  '3m': { range: '3mo', interval: '1d' },
  '6m': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
  'max': { range: 'max', interval: '1mo' },
};

async function fetchSingleYahooSymbol(symbol: string) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let response: Response | null = null;
  try {
    response = await fetchWithTimeout(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?interval=1d&range=3mo`,
      { headers },
      4500
    );
  } catch {
    // try fallback host
  }

  if (!response || !response.ok) {
    try {
      response = await fetchWithTimeout(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          symbol
        )}?interval=1d&range=3mo`,
        { headers },
        4500
      );
    } catch {
      // ignore
    }
  }

  if (!response || !response.ok) {
    throw new Error(`Yahoo Finance HTTP ${response ? response.status : 'timeout'}`);
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) {
    throw new Error(`Sem dados para o símbolo: ${symbol}`);
  }

  const meta = result.meta;
  const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0;
  if (!price || Number(price) <= 0) {
    throw new Error(`Preço nulo ou inválido para ${symbol}`);
  }

  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change = Number(price) - Number(previousClose);
  const changePercent = previousClose ? (change / Number(previousClose)) * 100 : 0;

  // Calculate Month-to-Date (MTD) Return from the start of the current month
  let monthReturnPercent = Number(changePercent);
  const timestamps: number[] = result.timestamp || [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

  if (timestamps.length > 0 && closes.length > 0) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let firstMonthPrice: number | null = null;
    let lastPrevMonthPrice: number | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined || isNaN(c) || c <= 0) continue;
      const d = new Date(timestamps[i] * 1000);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        if (firstMonthPrice === null) {
          firstMonthPrice = c;
        }
      } else if (
        d.getFullYear() < currentYear ||
        (d.getFullYear() === currentYear && d.getMonth() < currentMonth)
      ) {
        lastPrevMonthPrice = c;
      }
    }

    const monthBase = lastPrevMonthPrice || firstMonthPrice;
    if (monthBase && monthBase > 0) {
      monthReturnPercent = ((Number(price) - monthBase) / monthBase) * 100;
    }
  }

  return {
    symbol: meta.symbol || symbol,
    name: meta.shortName || meta.longName || meta.symbol || symbol,
    currency: (meta.currency || 'USD').toUpperCase(),
    price: Number(price),
    change: Number(change),
    changePercent: Number(changePercent),
    monthReturnPercent: Number(monthReturnPercent.toFixed(2)),
    previousClose: Number(previousClose),
    timestamp: Date.now(),
  };
}

async function fetchFromYahoo(ticker: string) {
  const cleanInput = ticker.trim().toUpperCase();
  const cacheKey = `ticker_${cleanInput}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // 1. Candidate symbols: US broker feeds attach .US which Yahoo rejects.
  // Prioritize stripped symbol first for US assets (e.g. ORCL.US -> ORCL, LEU.US -> LEU)
  const candidates: string[] = [];
  if (cleanInput.endsWith('.US')) {
    candidates.push(cleanInput.replace(/\.US$/i, ''));
  }
  if (!candidates.includes(cleanInput)) {
    candidates.push(cleanInput);
  }
  if (cleanInput.startsWith('US.')) {
    candidates.push(cleanInput.replace(/^US\./i, ''));
  }

  // Try candidate direct chart fetches
  for (const sym of candidates) {
    try {
      const data = await fetchSingleYahooSymbol(sym);
      cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch {
      // Continue to next candidate
    }
  }

  // 2. Smart search fallback by ticker/symbol name if direct query fails
  try {
    const searchQuery = cleanInput.replace(/\.US$/i, '');
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    };
    const searchRes = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
        searchQuery
      )}&quotesCount=5&newsCount=0`,
      { headers }
    );
    if (searchRes.ok) {
      const searchJson = await searchRes.json();
      const quotes = searchJson?.quotes || [];
      const matching = quotes.find(
        (q: any) =>
          q.symbol &&
          (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND')
      );
      if (matching && matching.symbol && !candidates.includes(matching.symbol.toUpperCase())) {
        const data = await fetchSingleYahooSymbol(matching.symbol);
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      }
    }
  } catch (searchErr) {
    console.warn(`Smart search fallback failed for ${cleanInput}:`, searchErr);
  }

  throw new Error(`Cotação indisponível`);
}

let yahooSessionCache: { cookie: string; crumb: string; timestamp: number } | null = null;
const summaryCache = new Map<string, CachedData<any>>();

async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (yahooSessionCache && Date.now() - yahooSessionCache.timestamp < 30 * 60 * 1000) {
    return { cookie: yahooSessionCache.cookie, crumb: yahooSessionCache.crumb };
  }

  try {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    
    // Step 1: get cookie from fc.yahoo.com
    const fcRes = await fetchWithTimeout('https://fc.yahoo.com', {
      headers: { 'User-Agent': userAgent },
    }, 3500);
    const cookie = fcRes.headers.get('set-cookie') || '';

    // Step 2: get crumb
    const crumbRes = await fetchWithTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': userAgent,
        Cookie: cookie,
      },
    }, 3500);
    if (!crumbRes.ok) return null;
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<html>')) return null;

    yahooSessionCache = { cookie, crumb: crumb.trim(), timestamp: Date.now() };
    return { cookie, crumb: crumb.trim() };
  } catch {
    return null;
  }
}

async function fetchQuoteSummaryData(symbol: string) {
  const cleanSymbol = symbol.trim().toUpperCase();
  const cacheKey = `qs_${cleanSymbol}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < QUOTE_SUMMARY_TTL_MS) {
    return cached.data;
  }

  const session = await getYahooSession();
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (session?.cookie) {
    headers['Cookie'] = session.cookie;
  }

  const crumbParam = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const modules = 'summaryDetail,defaultKeyStatistics,financialData,calendarEvents';

  try {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=${modules}${crumbParam}`,
        { headers },
        4000
      );
    } catch {
      // ignore
    }

    if (!res || !res.ok) {
      try {
        res = await fetchWithTimeout(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=${modules}${crumbParam}`,
          { headers },
          4000
        );
      } catch {
        // ignore
      }
    }

    if (!res || !res.ok) {
      if (cached) return cached.data;
      return null;
    }

    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0] || null;
    if (result) {
      summaryCache.set(cacheKey, { data: result, timestamp: Date.now() });
    }
    return result;
  } catch {
    if (cached) return cached.data;
    return null;
  }
}

async function fetchChartFromYahoo(ticker: string, requestedRange: string = '1m') {
  const cleanInput = ticker.trim().toUpperCase();
  const rangeConfig = CHART_RANGE_CONFIG[requestedRange.toLowerCase()] || CHART_RANGE_CONFIG['1m'];
  const cacheKey = `chart_${cleanInput}_${rangeConfig.range}_${rangeConfig.interval}`;
  
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 60000) { // 1 min cache
    return cached.data;
  }

  const candidates: string[] = [];
  if (cleanInput.endsWith('.US')) {
    candidates.push(cleanInput.replace(/\.US$/i, ''));
  }
  if (!candidates.includes(cleanInput)) {
    candidates.push(cleanInput);
  }
  if (cleanInput.startsWith('US.')) {
    candidates.push(cleanInput.replace(/^US\./i, ''));
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let lastError: any = null;
  const isShortPeriod = requestedRange === '1d' || requestedRange === '1w' || requestedRange === '1m';

  for (const sym of candidates) {
    try {
      let response: Response | null = null;
      try {
        response = await fetchWithTimeout(
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            sym
          )}?interval=${rangeConfig.interval}&range=${rangeConfig.range}&includePrePost=${isShortPeriod ? 'true' : 'false'}`,
          { headers },
          5000
        );
      } catch {
        // ignore
      }

      if (!response || !response.ok) {
        try {
          response = await fetchWithTimeout(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
              sym
            )}?interval=${rangeConfig.interval}&range=${rangeConfig.range}&includePrePost=${isShortPeriod ? 'true' : 'false'}`,
            { headers },
            5000
          );
        } catch {
          // ignore
        }
      }

      if (!response || !response.ok) continue;

      const json = await response.json();
      const result = json?.chart?.result?.[0];
      if (!result || !result.meta) continue;

      const meta = result.meta;
      const currency = (meta.currency || 'USD').toUpperCase();
      const isGBp = currency === 'GBP' || currency === 'GBp';
      const fxRate = await getFxRateToEur(isGBp ? 'GBP' : currency);

      const timestamps: number[] = result.timestamp || [];
      const quoteObj = result.indicators?.quote?.[0] || {};
      const closes: (number | null)[] = quoteObj.close || [];
      const opens: (number | null)[] = quoteObj.open || [];
      const highs: (number | null)[] = quoteObj.high || [];
      const lows: (number | null)[] = quoteObj.low || [];
      const volumes: (number | null)[] = quoteObj.volume || [];

      // Determine regular trading periods from meta
      const regularPeriods: Array<{ start: number; end: number }> = [];
      if (meta?.tradingPeriods?.regular && Array.isArray(meta.tradingPeriods.regular)) {
        for (const dayArray of meta.tradingPeriods.regular) {
          if (Array.isArray(dayArray)) {
            for (const p of dayArray) {
              if (p?.start && p?.end) {
                regularPeriods.push({ start: p.start, end: p.end });
              }
            }
          }
        }
      } else if (meta?.currentTradingPeriod?.regular) {
        regularPeriods.push({
          start: meta.currentTradingPeriod.regular.start,
          end: meta.currentTradingPeriod.regular.end,
        });
      }

      const points: Array<{
        timestamp: number;
        date: string;
        price: number;
        priceEur: number;
        isMarketOpen: boolean;
        high?: number;
        low?: number;
        highEur?: number;
        lowEur?: number;
        open?: number;
        volume?: number;
      }> = [];

      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c === null || c === undefined || isNaN(c) || c <= 0) continue;
        const rawSec = timestamps[i];
        const ts = rawSec * 1000;
        const nativeP = Number(c);
        const pEur = isGBp ? (nativeP / 100) * fxRate : nativeP * fxRate;
        
        let isMarketHours = true;
        if (isShortPeriod) {
          if (regularPeriods.length > 0) {
            isMarketHours = regularPeriods.some((p) => rawSec >= p.start && rawSec <= p.end);
          } else {
            const d = new Date(ts);
            const day = d.getUTCDay();
            const hour = d.getUTCHours();
            isMarketHours = day >= 1 && day <= 5 && (hour >= 13 && hour <= 20);
          }
        }

        const hVal = highs[i] ? Number(highs[i]!.toFixed(4)) : undefined;
        const lVal = lows[i] ? Number(lows[i]!.toFixed(4)) : undefined;
        const hEur = hVal != null ? Number((isGBp ? (hVal / 100) * fxRate : hVal * fxRate).toFixed(4)) : undefined;
        const lEur = lVal != null ? Number((isGBp ? (lVal / 100) * fxRate : lVal * fxRate).toFixed(4)) : undefined;

        points.push({
          timestamp: ts,
          date: new Date(ts).toISOString(),
          price: Number(nativeP.toFixed(4)),
          priceEur: Number(pEur.toFixed(4)),
          isMarketOpen: isMarketHours,
          open: opens[i] ? Number(opens[i]!.toFixed(4)) : undefined,
          high: hVal,
          low: lVal,
          highEur: hEur,
          lowEur: lEur,
          volume: volumes[i] ?? undefined,
        });
      }

      const currentPriceNative = meta.regularMarketPrice ?? (points.length > 0 ? points[points.length - 1].price : 0);
      const currentPriceEur = isGBp ? (currentPriceNative / 100) * fxRate : currentPriceNative * fxRate;
      const prevCloseNative = meta.chartPreviousClose ?? meta.previousClose ?? (points.length > 0 ? points[0].price : currentPriceNative);
      const prevCloseEur = isGBp ? (prevCloseNative / 100) * fxRate : prevCloseNative * fxRate;
      
      const firstPointPrice = points.length > 0 ? points[0].priceEur : currentPriceEur;
      const changeRange = currentPriceEur - firstPointPrice;
      const changeRangePercent = firstPointPrice > 0 ? (changeRange / firstPointPrice) * 100 : 0;

      // Extract detailed fundamentals and metrics from Quote Summary
      const summary = await fetchQuoteSummaryData(sym);
      const summaryDetail = summary?.summaryDetail || {};
      const keyStats = summary?.defaultKeyStatistics || {};
      const financial = summary?.financialData || {};
      const calendar = summary?.calendarEvents || {};

      // Day Range
      const dayHighNative = summaryDetail.dayHigh?.raw ?? meta.regularMarketDayHigh ?? null;
      const dayLowNative = summaryDetail.dayLow?.raw ?? meta.regularMarketDayLow ?? null;
      const dayHighEur = dayHighNative != null ? (isGBp ? (dayHighNative / 100) * fxRate : dayHighNative * fxRate) : null;
      const dayLowEur = dayLowNative != null ? (isGBp ? (dayLowNative / 100) * fxRate : dayLowNative * fxRate) : null;

      // 52-Week Range
      const fiftyTwoWeekHighNative = summaryDetail.fiftyTwoWeekHigh?.raw ?? meta.fiftyTwoWeekHigh ?? null;
      const fiftyTwoWeekLowNative = summaryDetail.fiftyTwoWeekLow?.raw ?? meta.fiftyTwoWeekLow ?? null;
      const fiftyTwoWeekHighEur = fiftyTwoWeekHighNative != null ? (isGBp ? (fiftyTwoWeekHighNative / 100) * fxRate : fiftyTwoWeekHighNative * fxRate) : null;
      const fiftyTwoWeekLowEur = fiftyTwoWeekLowNative != null ? (isGBp ? (fiftyTwoWeekLowNative / 100) * fxRate : fiftyTwoWeekLowNative * fxRate) : null;

      let fiftyTwoWeekRangePercent: number | null = null;
      if (fiftyTwoWeekHighEur != null && fiftyTwoWeekLowEur != null && fiftyTwoWeekHighEur > fiftyTwoWeekLowEur) {
        const ratio = (currentPriceEur - fiftyTwoWeekLowEur) / (fiftyTwoWeekHighEur - fiftyTwoWeekLowEur);
        fiftyTwoWeekRangePercent = Math.max(0, Math.min(100, ratio * 100));
      }

      // Valuation & Metrics: PE, PB, PS, EPS, Beta
      const pe = summaryDetail.trailingPE?.raw ?? summaryDetail.forwardPE?.raw ?? null;
      const pb = keyStats.priceToBook?.raw ?? null;
      const ps = summaryDetail.priceToSalesTrailing12Months?.raw ?? null;
      const epsNative = keyStats.trailingEps?.raw ?? keyStats.forwardEps?.raw ?? null;
      const epsEur = epsNative != null ? (isGBp ? (epsNative / 100) * fxRate : epsNative * fxRate) : null;
      const beta = summaryDetail.beta?.raw ?? keyStats.beta?.raw ?? null;

      // Analyst Estimates
      const targetPriceNative = financial.targetMeanPrice?.raw ?? null;
      const targetPriceEur = targetPriceNative != null ? (isGBp ? (targetPriceNative / 100) * fxRate : targetPriceNative * fxRate) : null;
      
      let recommendation: string | null = null;
      if (financial.recommendationKey) {
        const recKey = String(financial.recommendationKey).toLowerCase();
        if (recKey === 'strong_buy') recommendation = 'Compra Forte';
        else if (recKey === 'buy') recommendation = 'Compra';
        else if (recKey === 'hold') recommendation = 'Manter';
        else if (recKey === 'underperform') recommendation = 'Desempenho Inferior';
        else if (recKey === 'sell') recommendation = 'Venda';
      }

      // Dividends
      let dividendYield: number | null = null;
      if (summaryDetail.dividendYield?.raw != null) {
        dividendYield = summaryDetail.dividendYield.raw * 100;
      }
      const dividendRateNative = summaryDetail.dividendRate?.raw ?? null;
      const dividendRateEur = dividendRateNative != null ? (isGBp ? (dividendRateNative / 100) * fxRate : dividendRateNative * fxRate) : null;

      let exDividendDate: string | null = null;
      if (summaryDetail.exDividendDate?.raw) {
        exDividendDate = new Date(summaryDetail.exDividendDate.raw * 1000).toLocaleDateString('pt-PT', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }

      // Earnings Date
      let earningsDate: string | null = null;
      const earningsRaw = calendar.earnings?.earningsDate?.[0]?.raw;
      if (earningsRaw) {
        earningsDate = new Date(earningsRaw * 1000).toLocaleDateString('pt-PT', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }

      const metrics = {
        dayHigh: dayHighNative,
        dayLow: dayLowNative,
        dayHighEur,
        dayLowEur,
        fiftyTwoWeekHigh: fiftyTwoWeekHighNative,
        fiftyTwoWeekLow: fiftyTwoWeekLowNative,
        fiftyTwoWeekHighEur,
        fiftyTwoWeekLowEur,
        fiftyTwoWeekRangePercent,
        pe: pe != null ? Number(pe.toFixed(2)) : null,
        pb: pb != null ? Number(pb.toFixed(2)) : null,
        ps: ps != null ? Number(ps.toFixed(2)) : null,
        eps: epsNative != null ? Number(epsNative.toFixed(2)) : null,
        epsEur: epsEur != null ? Number(epsEur.toFixed(2)) : null,
        beta: beta != null ? Number(beta.toFixed(2)) : null,
        targetPrice: targetPriceNative != null ? Number(targetPriceNative.toFixed(2)) : null,
        targetPriceEur: targetPriceEur != null ? Number(targetPriceEur.toFixed(2)) : null,
        recommendation,
        dividendYield: dividendYield != null ? Number(dividendYield.toFixed(2)) : null,
        dividendRate: dividendRateNative != null ? Number(dividendRateNative.toFixed(2)) : null,
        dividendRateEur: dividendRateEur != null ? Number(dividendRateEur.toFixed(2)) : null,
        exDividendDate,
        earningsDate,
      };

      const chartData = {
        symbol: meta.symbol || sym,
        name: meta.shortName || meta.longName || sym,
        currency,
        fxRateToEur: Number(fxRate.toFixed(4)),
        currentPrice: Number(currentPriceNative.toFixed(4)),
        currentPriceEur: Number(currentPriceEur.toFixed(4)),
        previousClose: Number(prevCloseNative.toFixed(4)),
        previousCloseEur: Number(prevCloseEur.toFixed(4)),
        rangeChange: Number(changeRange.toFixed(4)),
        rangeChangePercent: Number(changeRangePercent.toFixed(2)),
        range: requestedRange,
        points,
        metrics,
      };

      cache.set(cacheKey, { data: chartData, timestamp: Date.now() });
      return chartData;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Gráfico indisponível para ${ticker}`);
}

async function getFxRateToEur(fromCurrency: string): Promise<number> {
  const cleanFrom = fromCurrency.toUpperCase();
  if (cleanFrom === 'EUR') return 1.0;

  try {
    const fx = await getExchangeRate(cleanFrom, 'EUR');
    return fx.rate;
  } catch (error) {
    console.warn(`Failed multi-API FX rate for ${cleanFrom}, fallback to 1.0`, error);
    return 1.0;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API: Search Yahoo Finance instruments
  app.get('/api/search', async (req, res) => {
    try {
      const query = (req.query.q as string || '').trim();
      if (!query) {
        return res.json({ quotes: [] });
      }

      const cacheKey = `search_${query.toLowerCase()}`;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.json({ quotes: cached.data });
      }

      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,pt;q=0.8',
      };

      let response: Response | null = null;
      try {
        response = await fetchWithTimeout(
          `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
            query
          )}&quotesCount=10&newsCount=0`,
          { headers },
          4000
        );
      } catch {
        // ignore
      }

      if (!response || !response.ok) {
        try {
          response = await fetchWithTimeout(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
              query
            )}&quotesCount=10&newsCount=0`,
            { headers },
            4000
          );
        } catch {
          // ignore
        }
      }

      if (!response || !response.ok) {
        if (cached) return res.json({ quotes: cached.data });
        return res.json({ quotes: [] });
      }

      const json = await response.json();
      const quotes = (json?.quotes || []).map((q: any) => ({
        symbol: q.symbol,
        shortname: q.shortname || q.longname || q.symbol,
        longname: q.longname || q.shortname || q.symbol,
        exchange: q.exchange || q.exchDisp || '',
        quoteType: q.quoteType || '',
        score: q.score || 0,
      }));

      cache.set(cacheKey, { data: quotes, timestamp: Date.now() });
      res.json({ quotes });
    } catch (err: any) {
      console.error('Yahoo search error:', err);
      res.status(500).json({ error: err?.message || 'Failed to search Yahoo Finance' });
    }
  });

  // API: Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // API: Get interactive historical chart for a ticker with EUR conversion
  app.get('/api/chart/:ticker', async (req, res) => {
    try {
      const ticker = req.params.ticker.trim();
      const range = (req.query.range as string || '1m').toLowerCase();
      const chartData = await fetchChartFromYahoo(ticker, range);
      res.json(chartData);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch chart data' });
    }
  });

  // API: Get quote for a ticker (with auto currency conversion to EUR)
  app.get('/api/quote/:ticker', async (req, res) => {
    try {
      const ticker = req.params.ticker.trim();
      const quote = await fetchFromYahoo(ticker);
      const isGBp = quote.currency === 'GBP' || quote.currency === 'GBP';
      
      const fxRate = await getFxRateToEur(isGBp ? 'GBP' : quote.currency);
      const nativePrice = quote.price;
      const priceInEur = isGBp ? (nativePrice / 100) * fxRate : nativePrice * fxRate;

      res.json({
        ...quote,
        priceInEur: Number(priceInEur.toFixed(4)),
        fxRateToEur: Number(fxRate.toFixed(4)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch quote' });
    }
  });

  // API: Batch quotes for multiple tickers
  app.post('/api/quotes', async (req, res) => {
    try {
      const tickers: string[] = req.body?.tickers || [];
      const results: Record<string, any> = {};

      await Promise.all(
        tickers.map(async (ticker) => {
          const key = ticker.trim().toUpperCase();
          try {
            const quote = await fetchFromYahoo(ticker);
            if (!quote || !quote.price || Number(quote.price) <= 0) {
              results[key] = { error: true, errorMessage: 'Cotação indisponível' };
              return;
            }

            const isGBp = quote.currency === 'GBP' || quote.currency === 'GBp';
            const fxRate = await getFxRateToEur(isGBp ? 'GBP' : quote.currency);
            const nativePrice = Number(quote.price);
            const priceInEur = isGBp ? (nativePrice / 100) * fxRate : nativePrice * fxRate;

            if (isNaN(priceInEur) || priceInEur <= 0) {
              results[key] = { error: true, errorMessage: 'Cotação indisponível' };
              return;
            }

            results[key] = {
              ...quote,
              priceInEur: Number(priceInEur.toFixed(4)),
              fxRateToEur: Number(fxRate.toFixed(4)),
            };
          } catch (e: any) {
            results[key] = { error: true, errorMessage: e?.message || 'Cotação indisponível' };
          }
        })
      );

      res.json({ quotes: results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch quotes' });
    }
  });

  // API: FX Rate
  app.get('/api/fx/:from', async (req, res) => {
    try {
      const from = req.params.from.toUpperCase();
      const rate = await getFxRateToEur(from);
      res.json({ from, to: 'EUR', rate });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch FX' });
    }
  });

  // API: Multi-API FX live conversion
  app.get('/api/fx/convert/rate', async (req, res) => {
    try {
      const from = (req.query.from as string || 'USD').toUpperCase();
      const to = (req.query.to as string || 'EUR').toUpperCase();
      const fx = await getExchangeRate(from, to);
      res.json(fx);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to convert currency' });
    }
  });

  // API: Parse portfolio PDF file
  app.post('/api/parse-pdf', async (req, res) => {
    try {
      const { pdfBase64 } = req.body;
      if (!pdfBase64) {
        return res.status(400).json({ error: 'Nenhum ficheiro PDF fornecido' });
      }

      // Remove data URL prefix if present
      const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      if (buffer.length === 0) {
        return res.status(400).json({ error: 'O ficheiro PDF está vazio' });
      }

      const result = await parsePortfolioPdf(buffer);
      res.json(result);
    } catch (err: any) {
      console.error('Error parsing PDF in /api/parse-pdf:', err);
      res.status(500).json({
        error: 'Erro ao analisar o PDF: ' + (err?.message || 'Formato não reconhecido'),
      });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
