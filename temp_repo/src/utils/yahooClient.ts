/**
 * Utility to convert raw tickers to Yahoo Finance compatible tickers
 * Rules requested:
 * - .US: remove (e.g. AAPL.US -> AAPL)
 * - .UK: replace with .L (e.g. VUSA.UK -> VUSA.L)
 * - .DE: keep as .DE (e.g. VWCE.DE -> VWCE.DE)
 */
export function convertTickerToYahoo(rawTicker: string): string {
  if (!rawTicker) return '';
  let ticker = rawTicker.trim();

  // If ticker ends with .US
  if (/\.US$/i.test(ticker)) {
    return ticker.replace(/\.US$/i, '');
  }

  // If ticker ends with .UK -> .L
  if (/\.UK$/i.test(ticker)) {
    return ticker.replace(/\.UK$/i, '.L');
  }

  // If .DE or other extensions, keep as is
  return ticker;
}

/**
 * Fetches the real-time quote for a Yahoo Finance ticker via the client-side API
 * Uses individual error handling so failures return null without breaking the caller.
 */
export async function fetchYahooQuote(symbol: string): Promise<{ price: number; currency?: string } | null> {
  if (!symbol) return null;
  const cleanSymbol = symbol.trim();
  try {
    // We try query2/query1 directly or through the available proxy
    const res = await fetch(`/api/quote/${encodeURIComponent(cleanSymbol)}`);
    if (!res.ok) {
      // Direct Yahoo fallback if proxy failed or in client-side mode
      try {
        const directRes = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=1d&range=1d`
        );
        if (directRes.ok) {
          const json = await directRes.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta) {
            const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
            if (typeof price === 'number') {
              return { price, currency: meta.currency };
            }
          }
        }
      } catch {
        // Ignore fallback error
      }
      return null;
    }
    const data = await res.json();
    if (data && typeof data.price === 'number') {
      return { price: data.price, currency: data.currency };
    }
    return null;
  } catch (err) {
    // Individual error handling: don't throw, just return null
    return null;
  }
}
