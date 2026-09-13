import * as XLSX from 'xlsx';

export interface DepositItem {
  time: string;
  amount: number;
}

export interface ParsedPositionItem {
  id: string;
  product: string;
  name: string;
  rawTicker: string;
  ticker: string;
  isTickerIdentified: boolean;
  category: string;
  volume: number;
  value: number;
  currentPrice?: number;
  profit?: number;
  currency?: string;
  exchange?: string;
  country?: string;
  description?: string;
  extraInfo?: Record<string, string>;
  possibleMatches?: { symbol: string; shortname: string; exchange: string }[];
}

export interface ExcelParseResult {
  deposits: DepositItem[];
  totalDeposited: number;
  openPositions: ParsedPositionItem[];
  totalPositionValue: number;
  totalUnrealizedPnL: number;
  openPositionsCount: number;
  summaryValue?: number;
  summaryProfit?: number;
}

/**
 * Normalizes string for header matching
 */
function cleanStr(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Parses numeric values safely from strings like "391.72", "391,72", "€391.72", etc.
 */
function parseNumeric(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val)
    .replace(/[€$£\s]/g, '')
    .replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Formats date/time from excel serial or string
 */
function formatTime(val: any): string {
  if (!val) return '—';
  if (typeof val === 'number') {
    // Excel date serial conversion
    try {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj) {
        const d = String(dateObj.d).padStart(2, '0');
        const m = String(dateObj.m).padStart(2, '0');
        const y = dateObj.y;
        return `${d}/${m}/${y}`;
      }
    } catch {
      // ignore
    }
  }
  const str = String(val).trim();
  // If it's a date string like 2026-07-31 or 31/07/2026
  if (str.includes('T')) {
    return str.split('T')[0].split('-').reverse().join('/');
  }
  return str;
}

export function parsePortfolioExcel(fileBuffer: ArrayBuffer): ExcelParseResult {
  const originalError = console.error;
  let workbook: XLSX.WorkBook;
  try {
    console.error = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (
        msg.includes('Bad uncompressed size') ||
        msg.includes('Bad compressed size') ||
        msg.includes('Bad CRC32 checksum')
      ) {
        return;
      }
      originalError.apply(console, args);
    };
    workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
  } finally {
    console.error = originalError;
  }

  // 1. Parse Cash Operations
  const cashSheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase().includes('cash') || name.toLowerCase().includes('caixa')
  );

  const deposits: DepositItem[] = [];
  let totalDeposited = 0;

  if (cashSheetName) {
    const cashSheet = workbook.Sheets[cashSheetName];
    const cashRows: any[][] = XLSX.utils.sheet_to_json(cashSheet, { header: 1, defval: '' });

    // Locate header row containing "Type", "Instrument", "Ticker", "Amount", "Time"
    let headerRowIdx = -1;
    let typeCol = -1;
    let amountCol = -1;
    let timeCol = -1;

    for (let r = 0; r < Math.min(25, cashRows.length); r++) {
      const row = cashRows[r];
      if (!Array.isArray(row)) continue;
      const rowStrings = row.map((cell) => cleanStr(cell).toLowerCase());

      const tIdx = rowStrings.findIndex((c) => c === 'type' || c === 'tipo');
      const aIdx = rowStrings.findIndex(
        (c) => c === 'amount' || c === 'montante' || c === 'valor'
      );
      const timeI = rowStrings.findIndex(
        (c) => c === 'time' || c === 'data' || c === 'date'
      );

      if (tIdx !== -1 && aIdx !== -1) {
        headerRowIdx = r;
        typeCol = tIdx;
        amountCol = aIdx;
        timeCol = timeI !== -1 ? timeI : 4;
        break;
      }
    }

    if (headerRowIdx !== -1) {
      for (let r = headerRowIdx + 1; r < cashRows.length; r++) {
        const row = cashRows[r];
        if (!row || row.length === 0) continue;

        const typeVal = cleanStr(row[typeCol]);
        if (typeVal.toLowerCase() === 'deposit' || typeVal.toLowerCase() === 'depósito') {
          const amount = parseNumeric(row[amountCol]);
          const time = formatTime(row[timeCol]);
          deposits.push({ time, amount });
          totalDeposited += amount;
        }
      }
    }
  }

  // 2. Parse Open Positions
  const openPositionsSheetName = workbook.SheetNames.find(
    (name) =>
      name.toLowerCase().includes('open') ||
      name.toLowerCase().includes('posiç') ||
      name.toLowerCase().includes('posic')
  );

  const openPositions: ParsedPositionItem[] = [];
  let summaryValue: number | undefined;
  let summaryProfit: number | undefined;

  if (openPositionsSheetName) {
    const sheet = workbook.Sheets[openPositionsSheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Locate header row for Open Positions
    // Product | Instrument/Position | Ticker | Category | Type | Volume | Value | Current price
    let headerRowIdx = -1;
    let productCol = -1;
    let instrumentCol = -1;
    let tickerCol = -1;
    let categoryCol = -1;
    let typeCol = -1;
    let volumeCol = -1;
    let valueCol = -1;
    let priceCol = -1;
    let profitCol = -1;
    let metricCol = -1;
    let summaryAmountCol = -1;

    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const rowStrings = row.map((cell) => cleanStr(cell).toLowerCase());

      const prodIdx = rowStrings.findIndex((c) => c.includes('product') || c.includes('produto'));
      const instIdx = rowStrings.findIndex(
        (c) => c.includes('instrument') || c.includes('position') || c.includes('ativo')
      );
      const tickIdx = rowStrings.findIndex((c) => c.includes('ticker') || c.includes('símbolo'));
      const valIdx = rowStrings.findIndex(
        (c) => c === 'value' || c === 'valor' || c.includes('open position value')
      );

      if (prodIdx !== -1 || (instIdx !== -1 && tickIdx !== -1)) {
        headerRowIdx = r;
        productCol = prodIdx !== -1 ? prodIdx : 0;
        instrumentCol = instIdx !== -1 ? instIdx : 1;
        tickerCol = tickIdx !== -1 ? tickIdx : 2;
        categoryCol = rowStrings.findIndex((c) => c.includes('category') || c.includes('categoria'));
        typeCol = rowStrings.findIndex((c) => c === 'type' || c === 'tipo');
        volumeCol = rowStrings.findIndex(
          (c) => c === 'volume' || c === 'shares' || c.includes('qtd') || c.includes('quant')
        );
        valueCol = valIdx !== -1 ? valIdx : rowStrings.findIndex((c) => c.includes('value'));
        priceCol = rowStrings.findIndex((c) => c.includes('price') || c.includes('preço'));
        profitCol = rowStrings.findIndex(
          (c) => c.includes('profit') || c.includes('p/l') || c.includes('lucro') || c.includes('gain')
        );
        metricCol = rowStrings.findIndex((c) => c.includes('metric') || c.includes('métrica'));
        summaryAmountCol = rowStrings.findIndex((c) => c.includes('amount') || c.includes('montante'));
        break;
      }
    }

    const startR = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

    for (let r = startR; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const product = cleanStr(row[productCol]);
      const instrument = cleanStr(row[instrumentCol]);
      const ticker = cleanStr(row[tickerCol]);
      const category = categoryCol !== -1 ? cleanStr(row[categoryCol]) : '';
      const type = typeCol !== -1 ? cleanStr(row[typeCol]) : '';
      const volume = volumeCol !== -1 ? parseNumeric(row[volumeCol]) : 0;
      const value = valueCol !== -1 ? parseNumeric(row[valueCol]) : 0;
      const currentPrice = priceCol !== -1 ? parseNumeric(row[priceCol]) : 0;
      const profit = profitCol !== -1 ? parseNumeric(row[profitCol]) : undefined;

      // Check for summary rows:
      // My Trades | Open position value / Open position profit
      const rowStr = row.map((c) => cleanStr(c)).join(' ');
      if (rowStr.includes('Open position value')) {
        const foundVal = row.find(
          (c, idx) => idx !== instrumentCol && typeof c === 'number' && c > 0
        ) || parseNumeric(row[summaryAmountCol !== -1 ? summaryAmountCol : valueCol]);
        if (foundVal) summaryValue = parseNumeric(foundVal);
      }
      if (rowStr.includes('Open position profit')) {
        const foundProfit = row.find(
          (c, idx) => idx !== instrumentCol && typeof c === 'number'
        ) || parseNumeric(row[summaryAmountCol !== -1 ? summaryAmountCol : valueCol]);
        if (foundProfit !== undefined) summaryProfit = parseNumeric(foundProfit);
      }

      // Filter aggregated open positions:
      // Product == "My Trades" (or instrument present)
      // Category is not empty (e.g. "ETF" or "STOCK") or value > 0
      // Type is empty (NOT "BUY", NOT "SELL")
      const isMyTrades =
        product.toLowerCase().includes('my trades') ||
        (headerRowIdx !== -1 && category.length > 0 && !product.toLowerCase().includes('summary')) ||
        (value > 0 && volume > 0 && type !== 'BUY' && type !== 'SELL');

      const isAggregate =
        type === '' || type === '—' || type === '-' || type.toLowerCase() === 'open';

      const hasCategory =
        category.toUpperCase() === 'ETF' ||
        category.toUpperCase() === 'STOCK' ||
        category.length > 0 ||
        instrument.length > 0;

      const hasValidTicker =
        ticker.length > 0 &&
        ticker.toUpperCase() !== 'TICKER' &&
        ticker.toUpperCase() !== 'N/A' &&
        ticker !== '—';

      // Keep position even if ticker is missing or ambiguous!
      if (isMyTrades && isAggregate && hasCategory && value > 0) {
        const rawTicker = hasValidTicker ? ticker.toUpperCase() : '';
        const positionTicker = rawTicker ? rawTicker : 'Ticker: não identificado';

        openPositions.push({
          id: `pos-${r}-${ticker || instrument}`,
          product: product || 'My Trades',
          name: instrument || ticker || 'Ativo sem nome',
          rawTicker,
          ticker: positionTicker,
          isTickerIdentified: hasValidTicker,
          category: category || 'ETF',
          volume,
          value,
          currentPrice,
          profit,
        });
      }
    }
  }

  // Calculate totals
  const totalPositionValue = openPositions.reduce((acc, p) => acc + p.value, 0);

  // Calculate total PnL: sum individual profits if available, else summaryProfit
  let totalUnrealizedPnL = 0;
  const hasIndividualPnL = openPositions.some((p) => p.profit !== undefined && p.profit !== 0);

  if (hasIndividualPnL) {
    totalUnrealizedPnL = openPositions.reduce((acc, p) => acc + (p.profit || 0), 0);
  } else if (summaryProfit !== undefined) {
    totalUnrealizedPnL = summaryProfit;
  } else if (totalDeposited > 0 && totalPositionValue > 0) {
    // Difference between positions value and total deposited
    totalUnrealizedPnL = totalPositionValue - totalDeposited;
  }

  return {
    deposits,
    totalDeposited: Number(totalDeposited.toFixed(2)),
    openPositions,
    totalPositionValue: Number(totalPositionValue.toFixed(2)),
    totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
    openPositionsCount: openPositions.length,
    summaryValue,
    summaryProfit,
  };
}
