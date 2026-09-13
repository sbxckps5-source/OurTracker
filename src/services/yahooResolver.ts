import { ParsedPositionItem } from '../utils/excelParser';

export interface YahooSearchQuote {
  symbol: string;
  shortname: string;
  longname: string;
  exchange: string;
  quoteType: string;
  score?: number;
}

/**
 * Searches Yahoo Finance for instruments matching a query
 */
export async function searchYahoo(query: string): Promise<YahooSearchQuote[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.quotes || [];
  } catch (err) {
    console.error('Error searching Yahoo Finance:', err);
    return [];
  }
}

/**
 * Validates a quote directly from Yahoo Finance
 */
export async function validateTickerQuote(ticker: string): Promise<any | null> {
  if (!ticker || ticker.includes(' ') || ticker.toLowerCase().includes('não identificado')) {
    return null;
  }
  try {
    const res = await fetch(`/api/quote/${encodeURIComponent(ticker.trim().toUpperCase())}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.price) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Clean strings for matching
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates a simple similarity score between two strings
 */
function nameSimilarity(a: string, b: string): number {
  const wordsA = normalize(a).split(' ').filter((w) => w.length > 2);
  const wordsB = normalize(b).split(' ').filter((w) => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.some((wb) => wb.includes(w) || w.includes(wb))) {
      common++;
    }
  }
  return common / Math.max(wordsA.length, wordsB.length);
}

/**
 * Resolves or confirms the ticker for a parsed open position using Yahoo Finance
 */
export async function resolvePositionTicker(
  position: ParsedPositionItem
): Promise<ParsedPositionItem> {
  const updated: ParsedPositionItem = { ...position };

  // 1. If a rawTicker exists and is formatted like a ticker (e.g. "SXR8.DE", "VVSM.DE", "AAPL")
  if (position.rawTicker && position.rawTicker.length >= 2) {
    const directQuote = await validateTickerQuote(position.rawTicker);
    if (directQuote) {
      updated.ticker = directQuote.symbol || position.rawTicker.toUpperCase();
      updated.isTickerIdentified = true;
      updated.currentPrice = directQuote.priceInEur || directQuote.price;
      return updated;
    }

    // If rawTicker has no suffix (e.g. "SXR8"), try German/European suffixes if currency/market suggests EUR
    if (!position.rawTicker.includes('.')) {
      const candidates = [
        `${position.rawTicker}.DE`,
        `${position.rawTicker}.F`,
        `${position.rawTicker}.PA`,
        `${position.rawTicker}.AS`,
        `${position.rawTicker}.L`,
      ];
      for (const cand of candidates) {
        const testQuote = await validateTickerQuote(cand);
        if (testQuote) {
          updated.ticker = testQuote.symbol;
          updated.isTickerIdentified = true;
          updated.currentPrice = testQuote.priceInEur || testQuote.price;
          return updated;
        }
      }
    }
  }

  // 2. Search Yahoo Finance with available info
  const searchQueries: string[] = [];
  if (position.rawTicker && position.rawTicker.length >= 2) {
    searchQueries.push(position.rawTicker);
  }
  if (position.name) {
    searchQueries.push(position.name);
    // Remove words like "UCITS ETF", "Acc", "Dist" to search core name
    const cleanedName = position.name
      .replace(/ucits|etf|acc|dist|accumulating|distributing|\(acc\)|\(dist\)/gi, '')
      .trim();
    if (cleanedName.length >= 3 && cleanedName !== position.name) {
      searchQueries.push(cleanedName);
    }
  }

  let foundQuotes: YahooSearchQuote[] = [];
  for (const q of searchQueries) {
    const results = await searchYahoo(q);
    if (results.length > 0) {
      foundQuotes = results;
      break;
    }
  }

  updated.possibleMatches = foundQuotes.map((fq) => ({
    symbol: fq.symbol,
    shortname: fq.shortname,
    exchange: fq.exchange,
  }));

  if (!foundQuotes.length) {
    updated.ticker = 'Ticker: não identificado';
    updated.isTickerIdentified = false;
    return updated;
  }

  // Rank matches:
  // Preference for EUR exchanges if European ETF (e.g. GER, FRA, ETR, XETRA, LSE)
  const isEtf = position.category?.toUpperCase() === 'ETF';
  let bestMatch: YahooSearchQuote | null = null;
  let bestScore = -1;

  for (const candidate of foundQuotes) {
    let score = candidate.score || 0;

    // Type match
    if (isEtf && candidate.quoteType === 'ETF') score += 15;
    if (!isEtf && candidate.quoteType === 'EQUITY') score += 15;

    // European exchange bonus if European context
    const ex = (candidate.exchange || '').toUpperCase();
    const sym = (candidate.symbol || '').toUpperCase();
    if (sym.endsWith('.DE') || ex.includes('GER') || ex.includes('XETR') || ex.includes('FRA')) {
      score += 20;
    }

    // Name similarity
    const sim = nameSimilarity(
      position.name,
      `${candidate.shortname} ${candidate.longname}`
    );
    score += sim * 40;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestMatch && bestScore >= 15) {
    // Validate quote of best match
    const validQuote = await validateTickerQuote(bestMatch.symbol);
    if (validQuote) {
      updated.ticker = bestMatch.symbol;
      updated.isTickerIdentified = true;
      updated.currentPrice = validQuote.priceInEur || validQuote.price;
      return updated;
    }
  }

  // If no confident match can be determined
  updated.ticker = 'Ticker: não identificado';
  updated.isTickerIdentified = false;
  return updated;
}
