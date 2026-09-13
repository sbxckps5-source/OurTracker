import { convertTickerToYahoo, fetchYahooQuote } from './yahooClient';
import { PurchaseRecord } from '../types';

// Declare SheetJS window object
declare global {
  interface Window {
    XLSX?: any;
  }
}

export interface ClientLoadedPosition {
  id: string;
  ticker: string;
  yahooTicker: string;
  name: string;
  category: string;
  volume: number;
  value: number; // Valor investido
  openPrice: number; // Preço médio de abertura
  currentPrice: number | null; // Preço atual da Yahoo Finance (ou null se falhar)
  profitEur: number | null; // (currentPrice - openPrice) * volume
  profitPercent: number | null; // ((currentPrice / openPrice) - 1) * 100
  isLoadingPrice: boolean;
  purchases?: PurchaseRecord[];
}

export interface ClientPortfolioDeposit {
  id: string;
  date: string;
  amount: number;
  comment?: string;
}

export interface ClientPortfolioData {
  totalDeposited: number;
  oldestDepositDate: Date | null;
  investedDays: number;
  positions: ClientLoadedPosition[];
  deposits?: ClientPortfolioDeposit[];
}

function parseNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).replace(/[€$£\s]/g, '').replace(',', '.');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseDateValue(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val;
  }
  if (typeof val === 'number') {
    // Excel date serial number conversion
    const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(dateObj.getTime())) return dateObj;
  }
  const str = String(val).trim();
  // Try ISO or standard format
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;

  // Try DD/MM/YYYY or DD.MM.YYYY
  const parts = str.split(/[\/\.\-\s]/);
  if (parts.length >= 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Ensures SheetJS library is dynamically loaded in browser window
 */
export async function ensureSheetJS(): Promise<any> {
  if (window.XLSX) {
    return window.XLSX;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
    script.async = true;
    script.onload = () => {
      if (window.XLSX) {
        resolve(window.XLSX);
      } else {
        reject(new Error('Falha ao carregar a biblioteca SheetJS.'));
      }
    };
    script.onerror = () => reject(new Error('Erro de ligação ao carregar a biblioteca SheetJS via CDN.'));
    document.head.appendChild(script);
  });
}

/**
 * Parses client-side Excel buffer (.xlsx)
 */
export async function parseExcelPortfolio(buffer: ArrayBuffer): Promise<ClientPortfolioData> {
  const XLSX = await ensureSheetJS();

  // Silence harmless warnings during reading of broker zip formats
  const originalError = console.error;
  let workbook: any;
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
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } finally {
    console.error = originalError;
  }

  const sheetNames: string[] = workbook.SheetNames || [];

  // Helper to find sheet case-insensitively
  const findSheet = (target: string): any => {
    const found = sheetNames.find((name) => name.trim().toLowerCase() === target.toLowerCase());
    return found ? workbook.Sheets[found] : null;
  };

  // 1. CASH OPERATIONS SHEET
  const cashSheet =
    findSheet('Cash Operations') ||
    findSheet('CashOperations') ||
    findSheet('Cash') ||
    findSheet('Operações de Caixa') ||
    workbook.Sheets[sheetNames[0]];

  let totalDeposited = 0;
  let oldestDepositDate: Date | null = null;
  const individualDeposits: ClientPortfolioDeposit[] = [];

  if (cashSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(cashSheet, { header: 1, defval: '' });

    let typeCol = -1;
    let amountCol = -1;
    let dateCol = -1;
    let headerRowIdx = -1;

    for (let r = 0; r < Math.min(25, rows.length); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const rowClean = row.map((cell) => String(cell || '').trim().toLowerCase());

      const tIdx = rowClean.findIndex((c) => c === 'type' || c.includes('tipo') || c.includes('operation'));
      const aIdx = rowClean.findIndex(
        (c) => c === 'amount' || c.includes('quantia') || c.includes('montante') || c.includes('valor')
      );
      const dIdx = rowClean.findIndex((c) => c === 'date' || c.includes('data') || c.includes('time'));

      if (tIdx !== -1 && aIdx !== -1) {
        headerRowIdx = r;
        typeCol = tIdx;
        amountCol = aIdx;
        dateCol = dIdx !== -1 ? dIdx : 0;
        break;
      }
    }

    const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const rawType = String(row[typeCol] || '').trim().toLowerCase();
      const amountVal = parseNumber(row[amountCol]);

      // Check if it's a deposit
      const isDeposit =
        rawType === 'deposit' ||
        rawType === 'depósito' ||
        rawType === 'deposito' ||
        rawType.includes('deposit') ||
        rawType.includes('depósito');

      if (isDeposit && amountVal > 0) {
        totalDeposited += amountVal;

        let dateStr = '';
        if (dateCol !== -1) {
          const parsedDate = parseDateValue(row[dateCol]);
          if (parsedDate) {
            if (!oldestDepositDate || parsedDate.getTime() < oldestDepositDate.getTime()) {
              oldestDepositDate = parsedDate;
            }
            dateStr = `${String(parsedDate.getDate()).padStart(2, '0')}/${String(
              parsedDate.getMonth() + 1
            ).padStart(2, '0')}/${parsedDate.getFullYear()}`;
          }
        }

        if (!dateStr) {
          const now = new Date();
          dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(
            now.getMonth() + 1
          ).padStart(2, '0')}/${now.getFullYear()}`;
        }

        individualDeposits.push({
          id: `dep-row-${r}-${Date.now()}`,
          date: dateStr,
          amount: Number(amountVal.toFixed(2)),
          comment: String(row[typeCol] || 'Depósito').trim(),
        });
      }
    }
  }

  // Calculate invested days until today
  let investedDays = 0;
  if (oldestDepositDate) {
    const today = new Date();
    const diffMs = today.getTime() - oldestDepositDate.getTime();
    investedDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  // 2. OPEN POSITIONS SHEET
  const positionsSheet =
    findSheet('Open Positions') ||
    findSheet('OpenPositions') ||
    findSheet('Posições Abertas') ||
    (sheetNames.length > 1 ? workbook.Sheets[sheetNames[1]] : null);

  // Map to group and deduplicate positions by normalized ticker
  const positionsMap = new Map<string, {
    rawTicker: string;
    yahooTicker: string;
    name: string;
    category: string;
    volume: number;
    value: number;
    openPrice: number;
    purchases: PurchaseRecord[];
    isFromAggregate?: boolean;
  }>();

  if (positionsSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(positionsSheet, { header: 1, defval: '' });

    let nameCol = -1;
    let tickerCol = -1;
    let categoryCol = -1;
    let typeCol = -1;
    let volumeCol = -1;
    let valueCol = -1;
    let openPriceCol = -1;
    let timeCol = -1;
    let headerRowIdx = -1;

    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const rowClean = row.map((cell) => String(cell || '').trim().toLowerCase());

      const nameIdx = rowClean.findIndex(
        (c) => c.includes('instrument') || c.includes('position') || c.includes('nome') || c.includes('product')
      );
      const tickIdx = rowClean.findIndex((c) => c === 'ticker' || c.includes('ticker') || c.includes('símbolo'));
      const catIdx = rowClean.findIndex((c) => c === 'category' || c.includes('categoria'));
      const tIdx = rowClean.findIndex((c) => c === 'type' || c === 'tipo');
      const volIdx = rowClean.findIndex((c) => c === 'volume' || c.includes('volume') || c.includes('shares') || c.includes('qtd'));
      const valIdx = rowClean.findIndex((c) => c === 'value' || c === 'valor' || c.includes('open position value'));
      const openPIdx = rowClean.findIndex((c) => c.includes('open price') || c.includes('preço de abertura') || c.includes('preco abertura') || c === 'price' || c === 'preço');
      const tTimeIdx = rowClean.findIndex((c) => c.includes('time') || c.includes('data') || c.includes('date') || c.includes('abertura'));

      if (tickIdx !== -1 || (catIdx !== -1 && valIdx !== -1)) {
        headerRowIdx = r;
        nameCol = nameIdx !== -1 ? nameIdx : 1;
        tickerCol = tickIdx !== -1 ? tickIdx : 2;
        categoryCol = catIdx !== -1 ? catIdx : 3;
        typeCol = tIdx !== -1 ? tIdx : 4;
        volumeCol = volIdx !== -1 ? volIdx : 5;
        valueCol = valIdx !== -1 ? valIdx : 6;
        openPriceCol = openPIdx !== -1 ? openPIdx : -1;
        timeCol = tTimeIdx !== -1 ? tTimeIdx : -1;
        break;
      }
    }

    const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
    let activeGroupKey = '';

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const rawType = String(row[typeCol] || '').trim().toUpperCase();
      const rawCategory = categoryCol !== -1 ? String(row[categoryCol] || '').trim() : '';
      const rawTicker = tickerCol !== -1 ? String(row[tickerCol] || '').trim() : '';
      const name = nameCol !== -1 ? String(row[nameCol] || '').trim() : rawTicker;
      const volume = volumeCol !== -1 ? parseNumber(row[volumeCol]) : 0;
      const value = valueCol !== -1 ? parseNumber(row[valueCol]) : 0;
      let openPrice = openPriceCol !== -1 ? parseNumber(row[openPriceCol]) : 0;
      const parsedDate = timeCol !== -1 ? parseDateValue(row[timeCol]) : null;

      if (volume === 0 && value === 0 && !rawTicker) continue;

      // Se openPrice for 0 mas tivermos volume e valor investido, calcular o preço médio = value / volume
      if (openPrice === 0 && volume > 0 && value > 0) {
        openPrice = value / volume;
      }

      const isBuyTransaction = rawType === 'BUY' || rawType === 'COMPRA';
      const isAggregate = !isBuyTransaction;

      const yahooTicker = convertTickerToYahoo(rawTicker);
      const groupKey = (yahooTicker || rawTicker || name).toUpperCase().trim();
      if (!groupKey) continue;
      activeGroupKey = groupKey;

      if (isAggregate) {
        // Aggregate Position row: represents final total position of the asset
        if (positionsMap.has(groupKey)) {
          const existing = positionsMap.get(groupKey)!;
          // Duplicate aggregate rows can just be added up
          const newVolume = existing.volume + volume;
          const newValue = existing.value + value;
          const newAvgPrice = newVolume > 0 && newValue > 0 ? newValue / newVolume : existing.openPrice;
          positionsMap.set(groupKey, {
            ...existing,
            volume: newVolume,
            value: newValue,
            openPrice: newAvgPrice,
            isFromAggregate: true,
          });
        } else {
          positionsMap.set(groupKey, {
            rawTicker: rawTicker || name,
            yahooTicker,
            name: name || rawTicker,
            category: rawCategory || 'Ação',
            volume,
            value,
            openPrice: openPrice > 0 ? openPrice : (volume > 0 && value > 0 ? value / volume : 0),
            purchases: [],
            isFromAggregate: true,
          });
        }
      } else {
        // Individual BUY transaction row
        if (!positionsMap.has(groupKey)) {
          // Initialize empty shell position (since there was no aggregate row yet)
          positionsMap.set(groupKey, {
            rawTicker: rawTicker || name,
            yahooTicker,
            name: name || rawTicker,
            category: rawCategory || 'Ação',
            volume: 0,
            value: 0,
            openPrice: 0,
            purchases: [],
            isFromAggregate: false,
          });
        }

        const pos = positionsMap.get(groupKey)!;
        const pPrice = openPrice > 0 ? openPrice : (volume > 0 && value > 0 ? value / volume : pos.openPrice);

        // If the position was not initialized from an aggregate row, accumulate its volume & value from the transactions
        if (!pos.isFromAggregate) {
          pos.volume += volume;
          pos.value += volume * pPrice;
          pos.openPrice = pos.volume > 0 ? pos.value / pos.volume : pPrice;
        }

        // Add to purchase lots list
        pos.purchases.push({
          id: `p-${r}-${Date.now()}`,
          date: parsedDate ? parsedDate.getTime() : (oldestDepositDate ? oldestDepositDate.getTime() : Date.now()),
          shares: volume,
          price: Number(pPrice.toFixed(4)),
          priceEur: Number(pPrice.toFixed(4)),
        });
      }
    }
  }

  const parsedPositions: ClientLoadedPosition[] = [];
  let index = 0;
  for (const [key, pos] of positionsMap.entries()) {
    let purchases = pos.purchases;
    if (!purchases || purchases.length === 0) {
      purchases = [
        {
          id: `p-init-${index}`,
          date: oldestDepositDate ? oldestDepositDate.getTime() : Date.now(),
          shares: pos.volume,
          price: pos.openPrice,
          priceEur: pos.openPrice,
        },
      ];
    } else {
      purchases.sort((a, b) => a.date - b.date);
    }

    parsedPositions.push({
      id: `pos-${index++}-${key}`,
      ticker: pos.rawTicker,
      yahooTicker: pos.yahooTicker,
      name: pos.name,
      category: pos.category,
      volume: pos.volume,
      value: pos.value,
      openPrice: pos.openPrice,
      currentPrice: null,
      profitEur: null,
      profitPercent: null,
      isLoadingPrice: true,
      purchases,
    });
  }

  return {
    totalDeposited,
    oldestDepositDate,
    investedDays,
    positions: parsedPositions,
    deposits: individualDeposits,
  };
}
