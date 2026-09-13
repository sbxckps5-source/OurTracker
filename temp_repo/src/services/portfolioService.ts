import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { HoldingDoc, PortfolioPosition, PurchaseRecord } from '../types';
import { convertTickerToYahoo } from '../utils/yahooClient';

// High-contrast, maximally distinct color palette ensuring adjacent and overall colors are never identical or confusing
export const DISTINCT_PALETTE = [
  '#2563EB', // Royal Blue
  '#EA580C', // Vibrant Orange
  '#16A34A', // Emerald Green
  '#9333EA', // Purple
  '#E11D48', // Ruby Red
  '#0D9488', // Teal
  '#D97706', // Amber / Warm Gold
  '#4F46E5', // Indigo
  '#65A30D', // Lime Green
  '#DB2777', // Hot Pink
  '#0284C7', // Sky Blue
  '#B45309', // Cinnamon Bronze
  '#7C3AED', // Electric Violet
  '#059669', // Dark Forest Mint
  '#DC2626', // Crimson Red
  '#0891B2', // Cyan
  '#C026D3', // Fuchsia
  '#84CC16', // Chartreuse
  '#1D4ED8', // Deep Cobalt
  '#F59E0B', // Bright Yellow
  '#8B5CF6', // Soft Lavender
  '#10B981', // Aqua Green
  '#F43F5E', // Rose
  '#334155', // Slate Navy
];

export function getDistinctColor(index: number): string {
  if (index < DISTINCT_PALETTE.length) {
    return DISTINCT_PALETTE[index];
  }
  // Golden ratio angle step creates maximally spaced hues around the color wheel for infinite items
  const hue = Math.round((index * 137.5077) % 360);
  return `hsl(${hue}, 82%, 46%)`;
}

export async function fetchLiveQuotes(tickers: string[], retries = 2): Promise<Record<string, any>> {
  if (!tickers || !tickers.length) return {};
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      
      const data = await res.json();
      return data.quotes || {};
    } catch (err) {
      if (attempt < retries) {
        // Wait 700ms before retrying on network jitter or server startup
        await new Promise((r) => setTimeout(r, 700));
      } else {
        console.warn('Live quotes fetch error after retries:', err);
      }
    }
  }
  
  return {};
}

// LocalStorage backup keys for offline / network jitter resilience
const LOCAL_HOLDINGS_KEY = (id: string) => `offline_holdings_${id}`;
const LOCAL_META_KEY = (id: string) => `offline_meta_${id}`;

function getLocalHoldings(portfolioId: string): HoldingDoc[] {
  try {
    const raw = localStorage.getItem(LOCAL_HOLDINGS_KEY(portfolioId));
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function setLocalHoldings(portfolioId: string, holdings: HoldingDoc[]) {
  try {
    localStorage.setItem(LOCAL_HOLDINGS_KEY(portfolioId), JSON.stringify(holdings));
  } catch (_) {}
}

export function subscribeUserHoldings(
  portfolioId: string = 'main',
  onUpdate: (holdings: HoldingDoc[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  // Emit initial local cached holdings immediately so UI never blocks on network connect
  const localCached = getLocalHoldings(portfolioId);
  if (localCached.length > 0) {
    onUpdate(localCached);
  }

  const holdingsRef = collection(db, 'portfolios', portfolioId, 'holdings');
  const q = query(holdingsRef, orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const holdings: HoldingDoc[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        holdings.push({
          id: docSnap.id,
          ticker: data.ticker || docSnap.id,
          shares: Number(data.shares || 0),
          createdAt: Number(data.createdAt || Date.now()),
          color: data.color,
          purchases: Array.isArray(data.purchases)
            ? data.purchases.map((p: any) => ({
                id: p.id,
                date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || data.createdAt || Date.now()),
                shares: Number(p.shares || 0),
                price: p.price !== undefined ? Number(p.price) : undefined,
                priceEur: p.priceEur !== undefined ? Number(p.priceEur) : undefined,
              }))
            : undefined,
        });
      });
      // Update local storage cache
      setLocalHoldings(portfolioId, holdings);
      onUpdate(holdings);
    },
    (err) => {
      // Gracefully log network / unavailable errors without crashing the app
      console.warn('Firestore subscription status:', err.message || err);
      // Fallback to local cached data
      const fallback = getLocalHoldings(portfolioId);
      if (fallback.length > 0) {
        onUpdate(fallback);
      }
      if (onError) onError(err);
    }
  );
}

export async function saveHolding(
  portfolioId: string = 'main',
  ticker: string,
  shares: number,
  color?: string,
  purchases?: any[]
): Promise<void> {
  const normalizedTicker = convertTickerToYahoo(ticker.trim()).toUpperCase();
  const rawTicker = ticker.trim().toUpperCase();

  // Se o ticker tinha .US, limpar documento antigo com .US para prevenir duplicados
  if (rawTicker !== normalizedTicker && rawTicker.endsWith('.US')) {
    try {
      await deleteDoc(doc(db, 'portfolios', portfolioId, 'holdings', rawTicker));
    } catch (_) {}
  }

  const docRef = doc(db, 'portfolios', portfolioId, 'holdings', normalizedTicker);
  const dataToSave: any = {
    ticker: normalizedTicker,
    shares: Number(shares),
    createdAt: Date.now(),
    color: color || DISTINCT_PALETTE[Math.floor(Math.random() * DISTINCT_PALETTE.length)],
  };
  if (purchases && purchases.length > 0) {
    dataToSave.purchases = purchases;
  }
  await setDoc(docRef, dataToSave, { merge: true });
}

export async function uploadClientPortfolioToCloud(
  portfolioId: string = 'main',
  portfolioData: {
    totalDeposited: number;
    oldestDepositDate: Date | null;
    positions: Array<{
      ticker: string;
      yahooTicker: string;
      name: string;
      category: string;
      volume: number;
      value: number;
      openPrice: number;
      purchases?: PurchaseRecord[];
    }>;
  }
): Promise<void> {
  // 1. Limpar quaisquer posições antigas/duplicadas existentes na coleção 'holdings'
  try {
    const holdingsRef = collection(db, 'portfolios', portfolioId, 'holdings');
    const existingSnap = await getDocs(holdingsRef);
    const deletePromises = existingSnap.docs.map((docSnap) => deleteDoc(docSnap.ref));
    await Promise.all(deletePromises);
  } catch (cleanErr) {
    console.warn('Aviso ao limpar posições antigas antes do upload:', cleanErr);
  }

  // 2. Guardar metadados do portfólio
  const depositsList = portfolioData.oldestDepositDate
    ? [
        {
          date: portfolioData.oldestDepositDate.toLocaleDateString('pt-PT'),
          amount: portfolioData.totalDeposited,
        },
      ]
    : [];

  await savePortfolioMeta(portfolioId, {
    totalDeposited: portfolioData.totalDeposited,
    currency: 'EUR',
    deposits: depositsList,
  });

  // 3. Guardar cada posição consolidada com todas as suas compras
  for (let i = 0; i < portfolioData.positions.length; i++) {
    const pos = portfolioData.positions[i];
    // Prefer yahooTicker if it was mapped, otherwise raw ticker
    const tickerToUse = (pos.yahooTicker || pos.ticker).trim().toUpperCase();

    let purchaseRecords: PurchaseRecord[] = [];
    if (pos.purchases && pos.purchases.length > 0) {
      purchaseRecords = pos.purchases.map((p, pIdx) => ({
        id: p.id || `p-${Date.now()}-${i}-${pIdx}`,
        date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date),
        shares: Number(p.shares),
        price: Number(p.price ?? pos.openPrice ?? 0),
        priceEur: Number(p.priceEur ?? p.price ?? pos.openPrice ?? 0),
      }));
    } else {
      purchaseRecords = [
        {
          id: `p-${Date.now()}-${i}`,
          date: portfolioData.oldestDepositDate ? portfolioData.oldestDepositDate.getTime() : Date.now(),
          shares: Number(pos.volume),
          price: Number(pos.openPrice || 0),
          priceEur: Number(pos.openPrice || 0),
        },
      ];
    }

    await saveHolding(
      portfolioId,
      tickerToUse,
      Number(pos.volume),
      DISTINCT_PALETTE[i % DISTINCT_PALETTE.length],
      purchaseRecords
    );
  }
}

export async function removeHolding(portfolioId: string = 'main', ticker: string): Promise<void> {
  const docRef = doc(db, 'portfolios', portfolioId, 'holdings', ticker.trim().toUpperCase());
  await deleteDoc(docRef);
}

export function computePortfolio(
  holdings: HoldingDoc[],
  quotes: Record<string, any>
): {
  totalValue: number;
  positions: PortfolioPosition[];
} {
  if (!holdings.length) {
    return { totalValue: 0, positions: [] };
  }

  // Agrupar holdings por ticker normalizado (evitando que AAPL e AAPL.US apareçam em duplicado)
  const consolidatedMap = new Map<string, {
    id: string;
    ticker: string;
    shares: number;
    color?: string;
  }>();

  holdings.forEach((holding) => {
    const normTicker = convertTickerToYahoo(holding.ticker.trim()).toUpperCase();
    if (consolidatedMap.has(normTicker)) {
      const existing = consolidatedMap.get(normTicker)!;
      consolidatedMap.set(normTicker, {
        ...existing,
        shares: existing.shares + Number(holding.shares),
      });
    } else {
      consolidatedMap.set(normTicker, {
        id: holding.id,
        ticker: normTicker,
        shares: Number(holding.shares),
        color: holding.color,
      });
    }
  });

  const consolidatedHoldings = Array.from(consolidatedMap.values());

  let totalValue = 0;
  const rawPositions: PortfolioPosition[] = [];

  consolidatedHoldings.forEach((holding, idx) => {
    const key = holding.ticker.trim().toUpperCase();
    // Check both exact ticker and possible stripped variant
    const quote = quotes[key] || quotes[key.replace(/\.US$/i, '')];
    const isError = !quote || Boolean(quote.error) || !quote.priceInEur || Number(quote.priceInEur) <= 0;

    const currentPriceInEur = isError ? 0 : Number(quote.priceInEur);
    const nativePrice = isError ? 0 : Number(quote.price || 0);
    const nativeCurrency = isError ? 'EUR' : (quote.currency || 'EUR');
    const fxRateToEur = isError ? 1.0 : Number(quote.fxRateToEur || 1.0);
    const name = quote?.name || holding.ticker;
    const changePercent = isError ? undefined : quote?.changePercent;
    const monthReturnPercent = isError ? undefined : quote?.monthReturnPercent;
    const value = isError ? 0 : Number((holding.shares * currentPriceInEur).toFixed(2));
    const fallbackColor = holding.color || getDistinctColor(idx);

    if (!isError) {
      totalValue += value;
    }

    rawPositions.push({
      id: holding.id,
      ticker: holding.ticker,
      name,
      shares: holding.shares,
      currentPrice: currentPriceInEur,
      nativePrice,
      nativeCurrency,
      fxRateToEur,
      value,
      allocationPercent: 0,
      changePercent,
      monthReturnPercent,
      color: fallbackColor,
      isError,
      errorMessage: isError ? (quote?.errorMessage || 'Cotação indisponível') : undefined,
    });
  });

  // Calculate allocation percentage, sort by value descending, and assign guaranteed unique distinct colors
  const positions: PortfolioPosition[] = rawPositions
    .map((p) => ({
      ...p,
      allocationPercent: totalValue > 0 && !p.isError ? Number(((p.value / totalValue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => {
      if (a.isError && !b.isError) return 1;
      if (!a.isError && b.isError) return -1;
      return b.value - a.value;
    })
    .map((p, index) => ({
      ...p,
      color: p.isError ? '#EF4444' : getDistinctColor(index),
    }));

  return {
    totalValue: Number(totalValue.toFixed(2)),
    positions,
  };
}

export async function savePortfolioMeta(
  portfolioId: string = 'main',
  meta: {
    currency?: string;
    totalDeposited?: number;
    account?: string;
    deposits?: Array<{ date: string; amount: number }>;
  }
): Promise<void> {
  const metaWithTimestamp = { ...meta, updatedAt: Date.now() };
  try {
    localStorage.setItem(LOCAL_META_KEY(portfolioId), JSON.stringify(metaWithTimestamp));
  } catch (_) {}
  try {
    const docRef = doc(db, 'portfolios', portfolioId);
    await setDoc(docRef, metaWithTimestamp, { merge: true });
  } catch (err) {
    console.warn('savePortfolioMeta Firestore warning (cached locally):', err);
  }
}

export async function fetchPortfolioMeta(portfolioId: string = 'main') {
  try {
    const metaRef = doc(db, 'portfolios', portfolioId);
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists()) {
      const data = metaSnap.data();
      try {
        localStorage.setItem(LOCAL_META_KEY(portfolioId), JSON.stringify(data));
      } catch (_) {}
      return data;
    }
  } catch (err) {
    console.warn('fetchPortfolioMeta Firestore warning (using local):', err);
  }

  // Fallback to local storage
  try {
    const local = localStorage.getItem(LOCAL_META_KEY(portfolioId));
    if (local) return JSON.parse(local);
  } catch (_) {}

  return null;
}

export interface BackupDoc {
  id: string;
  timestamp: number;
  formattedDate: string;
  holdingsCount: number;
  holdings: HoldingDoc[];
  meta?: any;
}

export function formatDateTimeNoSeconds(ts: number): string {
  const d = new Date(ts);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export async function createCloudBackup(portfolioId: string = 'main'): Promise<BackupDoc> {
  const holdingsRef = collection(db, 'portfolios', portfolioId, 'holdings');
  const holdingsSnap = await getDocs(holdingsRef);
  const holdings: HoldingDoc[] = [];
  holdingsSnap.forEach((docSnap) => {
    const data = docSnap.data();
    holdings.push({
      id: docSnap.id,
      ticker: data.ticker || docSnap.id,
      shares: Number(data.shares || 0),
      createdAt: Number(data.createdAt || Date.now()),
      color: data.color,
      purchases: data.purchases || [],
    });
  });

  const metaRef = doc(db, 'portfolios', portfolioId);
  const metaSnap = await getDoc(metaRef);
  const meta = metaSnap.exists() ? metaSnap.data() : null;

  const ts = Date.now();
  const formattedDate = formatDateTimeNoSeconds(ts);
  const backupId = `backup_${ts}`;

  const backupRef = doc(db, 'portfolios', portfolioId, 'backups', backupId);
  const backupData: BackupDoc = {
    id: backupId,
    timestamp: ts,
    formattedDate,
    holdingsCount: holdings.length,
    holdings,
    meta,
  };

  await setDoc(backupRef, backupData);
  await pruneCloudBackups(portfolioId, 5);
  return backupData;
}

export async function pruneCloudBackups(portfolioId: string = 'main', maxKeep = 5): Promise<void> {
  const backupsRef = collection(db, 'portfolios', portfolioId, 'backups');
  const q = query(backupsRef, orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);

  if (snap.docs.length > maxKeep) {
    const docsToDelete = snap.docs.slice(maxKeep);
    for (const d of docsToDelete) {
      await deleteDoc(d.ref);
    }
  }
}

export async function fetchCloudBackups(portfolioId: string = 'main'): Promise<BackupDoc[]> {
  const backupsRef = collection(db, 'portfolios', portfolioId, 'backups');
  const q = query(backupsRef, orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  const list: BackupDoc[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as BackupDoc;
    list.push({
      id: docSnap.id,
      timestamp: data.timestamp || Date.now(),
      formattedDate: data.formattedDate || formatDateTimeNoSeconds(data.timestamp || Date.now()),
      holdingsCount: data.holdingsCount !== undefined ? data.holdingsCount : (data.holdings ? data.holdings.length : 0),
      holdings: data.holdings || [],
      meta: data.meta,
    });
  });
  return list.slice(0, 5);
}

export async function restoreCloudBackup(backup: BackupDoc, portfolioId: string = 'main'): Promise<void> {
  // Clear current holdings
  const holdingsRef = collection(db, 'portfolios', portfolioId, 'holdings');
  const snap = await getDocs(holdingsRef);
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }

  // Restore backup holdings
  for (const h of backup.holdings) {
    const docRef = doc(db, 'portfolios', portfolioId, 'holdings', h.ticker.trim().toUpperCase());
    await setDoc(docRef, {
      ticker: h.ticker.trim().toUpperCase(),
      shares: Number(h.shares || 0),
      createdAt: h.createdAt || Date.now(),
      color: h.color,
      purchases: h.purchases || [],
    });
  }

  // Restore meta if exists
  if (backup.meta) {
    const metaRef = doc(db, 'portfolios', portfolioId);
    await setDoc(metaRef, backup.meta, { merge: true });
  }
}

