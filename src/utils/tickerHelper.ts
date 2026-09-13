/**
 * Helper to provide concise, friendly names for stock tickers and ETFs
 */

const KNOWN_TICKER_NAMES: Record<string, string> = {
  // S&P 500
  'SXR8': 'S&P 500',
  'SXR8.DE': 'S&P 500',
  'CSSPX': 'S&P 500',
  'VUAA': 'S&P 500',
  'VUAA.DE': 'S&P 500',
  'VUAA.L': 'S&P 500',
  'VUSA': 'S&P 500',
  'VOO': 'S&P 500',
  'IVV': 'S&P 500',
  'SPY': 'S&P 500',

  // Semiconductors & Tech
  'VVSM': 'Semicondutores',
  'VVSM.DE': 'Semicondutores',
  'SMH': 'Semicondutores',
  'SOXX': 'Semicondutores',
  'SOXQ': 'Semicondutores',
  'QDVE': 'Tecnologia EUA',
  'QDVE.DE': 'Tecnologia EUA',
  'XLK': 'Tecnologia EUA',
  'VGT': 'Tecnologia EUA',

  // Nasdaq 100
  'QQQ': 'Nasdaq 100',
  'EQQQ': 'Nasdaq 100',
  'UST.PA': 'Nasdaq 100',
  'EXXT': 'Nasdaq 100',
  'QQQM': 'Nasdaq 100',

  // World / All-World
  'VWCE': 'All-World',
  'VWCE.DE': 'All-World',
  'VWRL': 'All-World',
  'IWDA': 'MSCI World',
  'IWDA.AS': 'MSCI World',
  'SWDA': 'MSCI World',
  'EUNL': 'MSCI World',
  'VT': 'Total World',
  'URTH': 'MSCI World',

  // Emerging Markets
  'EMIM': 'Mercados Emergentes',
  'EIMI': 'Mercados Emergentes',
  'VWO': 'Mercados Emergentes',

  // Tech Giants & Popular Stocks
  'NVDA': 'NVIDIA',
  'AAPL': 'Apple',
  'MSFT': 'Microsoft',
  'AMZN': 'Amazon',
  'GOOGL': 'Alphabet',
  'GOOG': 'Alphabet',
  'META': 'Meta',
  'TSLA': 'Tesla',
  'NFLX': 'Netflix',
  'AMD': 'AMD',
  'INTC': 'Intel',
  'AVGO': 'Broadcom',
  'TSM': 'TSMC',
  'ASML': 'ASML',
  'ASML.AS': 'ASML',
  'PLTR': 'Palantir',
  'COIN': 'Coinbase',
  'SPCX': 'SpaceX',
  'SPCX.US': 'SpaceX',
  'SPACEX': 'SpaceX',
  'LEU': 'Centrus Energy',
  'CENTRUS': 'Centrus Energy',
  'SKM': 'SK Telecom',
  'SKTELECOM': 'SK Telecom',
  '017670.KS': 'SK Telecom',
  '000660.KS': 'SK Hynix',
  'HXSCF': 'SK Hynix',
  'SKHYNIX': 'SK Hynix',

  // Crypto / Commodities
  'BTC': 'Bitcoin',
  'BTC-USD': 'Bitcoin',
  'BTC-EUR': 'Bitcoin',
  'ETH': 'Ethereum',
  'ETH-USD': 'Ethereum',
  'ETH-EUR': 'Ethereum',
  'GLD': 'Ouro',
  'IAU': 'Ouro',
  '4GLD.DE': 'Ouro',
};

/**
 * Returns a clean, abbreviated and readable description for a ticker
 */
export function getShortDescription(ticker: string, rawName?: string): string {
  if (!ticker) return (rawName || '').replace(/\./g, '');
  const cleanTicker = ticker.trim().toUpperCase();

  // 1. Direct match in dictionary
  if (KNOWN_TICKER_NAMES[cleanTicker]) {
    return KNOWN_TICKER_NAMES[cleanTicker].replace(/\./g, '');
  }

  // 2. Match base ticker (e.g. SXR8.DE -> SXR8)
  const baseTicker = cleanTicker.split('.')[0];
  if (KNOWN_TICKER_NAMES[baseTicker]) {
    return KNOWN_TICKER_NAMES[baseTicker].replace(/\./g, '');
  }

  // 3. Clean up rawName if available
  if (rawName && rawName.trim().length > 0) {
    let name = rawName.trim();

    // Check for common ETF patterns in name
    if (/s&p\s*500/i.test(name)) return 'S&P 500';
    if (/semiconductor/i.test(name)) return 'Semicondutores';
    if (/nasdaq\s*100/i.test(name)) return 'Nasdaq 100';
    if (/all[-\s]?world/i.test(name)) return 'All-World';
    if (/msci\s*world/i.test(name)) return 'MSCI World';
    if (/emerging\s*markets/i.test(name)) return 'Mercados Emergentes';
    if (/spacex/i.test(name) || /spcx/i.test(name)) return 'SpaceX';
    if (/sk\s*hynix/i.test(name)) return 'SK Hynix';
    if (/sk\s*telecom/i.test(name)) return 'SK Telecom';
    if (/centrus/i.test(name)) return 'Centrus Energy';
    if (/google|alphabet/i.test(name)) return 'Alphabet';

    // Remove verbose ETF / corporate suffixes
    name = name
      .replace(/\b(UCITS\s*ETF|ETF|ACC|DIST|USD|EUR|GBP|Daily|Core|Index|Fund)\b/gi, '')
      .replace(/\b(Inc\.?|Corporation|Corp\.?|Holdings|Co\.?|plc|N\.V\.|Class\s*[A-C]|Common\s*Stock)\b/gi, '')
      .replace(/[\(\)\[\]\-]/g, ' ')
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (name.length > 0) {
      // Limit to max 2-3 words for brevity
      const words = name.split(' ').slice(0, 3).join(' ');
      return words.replace(/\./g, '');
    }
  }

  return cleanTicker.replace(/\./g, '');
}
