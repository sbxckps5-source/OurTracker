import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Search, ArrowRight, RotateCcw, AlertCircle, Calculator, ChevronLeft, Edit2, Check } from 'lucide-react';
import { getShortDescription } from '../utils/tickerHelper';
import { PortfolioPosition } from '../types';

export interface AllocationTarget {
  id: string;
  ticker: string;
  name: string;
  targetPercent: number;
}

export const DEFAULT_ALLOCATION_TARGETS: AllocationTarget[] = [
  { id: '1', ticker: 'SXR8.DE', name: 'S&P 500', targetPercent: 50 },
  { id: '2', ticker: 'SMH', name: 'Semicondutores', targetPercent: 12 },
  { id: '3', ticker: 'GOOGL', name: 'Alphabet', targetPercent: 5 },
  { id: '4', ticker: 'LEU', name: 'Centrus Energy', targetPercent: 5 },
  { id: '5', ticker: '000660.KS', name: 'SK Hynix', targetPercent: 6 },
  { id: '6', ticker: 'SKM', name: 'SK Telecom', targetPercent: 5 },
  { id: '7', ticker: 'ORCL', name: 'Oracle', targetPercent: 5 },
  { id: '8', ticker: 'AMZN', name: 'Amazon', targetPercent: 4 },
  { id: '9', ticker: 'SPCX.US', name: 'SpaceX', targetPercent: 6 },
  { id: '10', ticker: 'NOW', name: 'ServiceNow', targetPercent: 2 },
];

export const POPULAR_ASSETS: Array<{ symbol: string; shortname: string; exchange?: string; isPopular?: boolean }> = [
  // Top Index & Sector ETFs
  { symbol: 'SXR8.DE', shortname: 'iShares Core S&P 500 UCITS ETF', exchange: 'XETRA', isPopular: true },
  { symbol: 'VUAA.DE', shortname: 'Vanguard S&P 500 UCITS ETF', exchange: 'XETRA', isPopular: true },
  { symbol: 'SMH', shortname: 'VanEck Semiconductor ETF', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'QDVE.DE', shortname: 'iShares S&P 500 Tech Sector ETF', exchange: 'XETRA', isPopular: true },
  { symbol: 'VWCE.DE', shortname: 'Vanguard FTSE All-World UCITS ETF', exchange: 'XETRA', isPopular: true },
  { symbol: 'QQQ', shortname: 'Invesco QQQ (Nasdaq 100)', exchange: 'NASDAQ', isPopular: true },

  // Megacap & Tech Giants
  { symbol: 'NVDA', shortname: 'NVIDIA Corporation', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'MSFT', shortname: 'Microsoft Corporation', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'AMZN', shortname: 'Amazon.com, Inc.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'GOOGL', shortname: 'Alphabet Inc. (Google)', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'META', shortname: 'Meta Platforms, Inc.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'TSLA', shortname: 'Tesla, Inc.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'ASML', shortname: 'ASML Holding N.V.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'TSM', shortname: 'Taiwan Semiconductor (TSMC)', exchange: 'NYSE', isPopular: true },
  { symbol: 'AVGO', shortname: 'Broadcom Inc.', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'AMD', shortname: 'Advanced Micro Devices', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'PLTR', shortname: 'Palantir Technologies Inc.', exchange: 'NYSE', isPopular: true },

  // Growth, Nuclear, Cloud & Crypto
  { symbol: 'LEU', shortname: 'Centrus Energy Corp.', exchange: 'NYSE', isPopular: true },
  { symbol: 'ORCL', shortname: 'Oracle Corporation', exchange: 'NYSE', isPopular: true },
  { symbol: 'NOW', shortname: 'ServiceNow, Inc.', exchange: 'NYSE', isPopular: true },
  { symbol: '000660.KS', shortname: 'SK Hynix Inc.', exchange: 'KRX', isPopular: true },
  { symbol: 'SKM', shortname: 'SK Telecom Co., Ltd.', exchange: 'NYSE', isPopular: true },
  { symbol: 'SPCX.US', shortname: 'Destiny Tech100 (SpaceX)', exchange: 'NYSE', isPopular: true },
  { symbol: 'IBIT', shortname: 'iShares Bitcoin Trust ETF', exchange: 'NASDAQ', isPopular: true },
  { symbol: 'COIN', shortname: 'Coinbase Global, Inc.', exchange: 'NASDAQ', isPopular: true },
];

const STORAGE_KEY = 'portfolio_contribution_targets_v3';

function getBaseTicker(ticker: string): string {
  if (!ticker) return '';
  return ticker.split('.')[0].toUpperCase().trim();
}

function findMatchingPosition(
  target: AllocationTarget,
  positions: PortfolioPosition[]
): PortfolioPosition | null {
  if (!positions || positions.length === 0) return null;

  const targetTicker = target.ticker.toUpperCase().trim();
  const targetBase = getBaseTicker(targetTicker);
  const targetName = (target.name || '').toLowerCase().trim();

  // 1. Exact ticker match
  const exact = positions.find(
    (p) => p.ticker && p.ticker.toUpperCase().trim() === targetTicker
  );
  if (exact) return exact;

  // 2. Base ticker match
  const baseMatch = positions.find((p) => {
    if (!p.ticker) return false;
    const pBase = getBaseTicker(p.ticker);
    return (
      (pBase && pBase === targetBase) ||
      p.ticker.toUpperCase().startsWith(targetBase) ||
      targetTicker.startsWith(pBase)
    );
  });
  if (baseMatch) return baseMatch;

  // 3. Known aliases & keywords
  const aliases: Record<string, string[]> = {
    'SXR8.DE': ['sp500', 's&p 500', 's&p', 'sp 500', 'ishares core s&p 500', 'sxr8', 'vuaa', 'voo', 'spy'],
    'SMH': ['semicondutores', 'semiconductor', 'vaneck semiconductor', 'vvsm', 'smh', 'soxx', 'soxq'],
    'GOOGL': ['alphabet', 'google', 'googl', 'goog'],
    'LEU': ['centrus', 'centrus energy', 'leu'],
    '000660.KS': ['sk hynix', 'hynix', '000660'],
    'SKM': ['sk telecom', 'skm', 'sk telecom co'],
    'ORCL': ['oracle', 'orcl'],
    'AMZN': ['amazon', 'amzn'],
    'SPCX.US': ['spacex', 'spcx', 'space exploration'],
    'NOW': ['servicenow', 'service now', 'now'],
  };

  const extraKeywords = aliases[target.ticker] || [];
  const targetKeywords = [
    targetName,
    targetTicker.toLowerCase(),
    targetBase.toLowerCase(),
    ...extraKeywords,
  ].filter((k) => k && k.length > 2);

  const keywordMatch = positions.find((p) => {
    const pName = (p.name || '').toLowerCase();
    const pTicker = (p.ticker || '').toLowerCase();
    return targetKeywords.some(
      (kw) =>
        pName.includes(kw) ||
        pTicker.includes(kw) ||
        (kw.length > 3 && (kw.includes(pName) || kw.includes(pTicker)))
    );
  });

  return keywordMatch || null;
}

interface ContributionCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  positions?: PortfolioPosition[];
  totalValue?: number;
}

// Swipeable Item Component with Edit & Delete actions
const SwipeableTargetItem: React.FC<{
  item: {
    id: string;
    ticker: string;
    name: string;
    targetPercent: number;
    currentVal: number;
    calculatedAmount: number;
  };
  totalValue: number;
  onDelete: (id: string) => void;
  onPercentChange: (id: string, newPercentVal: string) => void;
  isOpenedId: string | null;
  setIsOpenedId: (id: string | null) => void;
}> = ({ item, totalValue, onDelete, onPercentChange, isOpenedId, setIsOpenedId }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(String(item.targetPercent));
  const finalVal = item.currentVal + item.calculatedAmount;
  const isSwiped = isOpenedId === item.id;

  const handleSavePercent = () => {
    onPercentChange(item.id, editVal);
    setIsEditing(false);
    setIsOpenedId(null);
  };

  return (
    <div className="relative overflow-hidden select-none bg-white rounded-2xl">
      {/* Background Actions (Revealed on Swipe Left) */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end z-0">
        <button
          type="button"
          onClick={() => {
            setIsEditing(true);
            setEditVal(String(item.targetPercent));
            setIsOpenedId(null);
          }}
          className="w-16 h-full bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
          title="Editar percentagem"
        >
          <Edit2 className="w-4 h-4" />
          <span className="text-[10px] font-bold">Editar</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onDelete(item.id);
            setIsOpenedId(null);
          }}
          className="w-16 h-full bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
          title="Apagar ação"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-[10px] font-bold">Apagar</span>
        </button>
      </div>

      {/* Foreground Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -128, right: 0 }}
        dragElastic={0.08}
        animate={{ x: isSwiped ? -128 : 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -40) {
            setIsOpenedId(item.id);
          } else {
            setIsOpenedId(null);
          }
        }}
        className="relative z-10 bg-white py-2.5 px-3 border-b border-slate-100/80 flex items-center justify-between gap-3 active:cursor-grabbing cursor-grab"
      >
        {/* Left: Stock Name, Ticker, and Evolution */}
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-xs sm:text-sm font-bold text-slate-800 truncate">
              {item.name}
            </span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase shrink-0">
              {item.ticker}
            </span>
          </div>

          {totalValue > 0 ? (
            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium mt-0.5">
              <span className="text-slate-500">
                {item.currentVal.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €
              </span>
              <span className="text-slate-300 font-bold">→</span>
              <span className="text-slate-800 font-bold">
                {finalVal.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 font-medium mt-0.5">
              Novo investimento
            </div>
          )}
        </div>

        {/* Right: Green Contribution Amount & Clean Percentage Badge / Inline Edit */}
        <div className="shrink-0 flex items-center gap-2">
          {/* Green calculated amount without '+' sign */}
          <span className="text-xs font-black text-emerald-600 tracking-tight text-right">
            {item.calculatedAmount.toLocaleString('pt-PT', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            €
          </span>

          {isEditing ? (
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-sky-400">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                max="100"
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSavePercent();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                autoFocus
                className="w-12 text-center font-black text-[16px] text-slate-800 bg-white border border-slate-200 rounded-lg py-1 outline-none shadow-2xs"
              />
              <span className="text-xs font-bold text-slate-400">%</span>
              <button
                type="button"
                onClick={handleSavePercent}
                className="p-1 bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (isSwiped) {
                  setIsOpenedId(null);
                } else {
                  setIsEditing(true);
                  setEditVal(String(item.targetPercent));
                }
              }}
              title="Toca para alterar percentagem ou desliza para a esquerda"
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all flex items-center gap-1 text-slate-700 cursor-pointer"
            >
              <span className="text-xs font-black tracking-tight">
                {item.targetPercent}%
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export const ContributionCalculatorModal: React.FC<ContributionCalculatorModalProps> = ({
  isOpen,
  onClose,
  positions = [],
  totalValue = 0,
}) => {
  const [step, setStep] = useState<'input_amount' | 'results'>('input_amount');
  const [amountInput, setAmountInput] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const [targets, setTargets] = useState<AllocationTarget[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_ALLOCATION_TARGETS;
  });

  // Search state for adding a new stock
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; shortname: string; exchange?: string }>>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Lock background scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      const originalTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.touchAction = originalTouchAction;
      };
    }
  }, [isOpen]);

  // Save targets to local storage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
    } catch {
      // ignore
    }
  }, [targets]);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setStep('input_amount');
      setAmountInput('');
      setIsSearching(false);
      setSearchQuery('');
      setSwipedId(null);
    }
  }, [isOpen]);

  // Search API handler with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearchLoading(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setIsSearchLoading(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const json = await res.json();
          setSearchResults(json.quotes || []);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.error('Search API error:', err);
        setSearchResults([]);
      } finally {
        setIsSearchLoading(false);
      }
    }, 280);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Combine popular assets (prioritized at the top) with API search results
  const displayedSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // When query is empty, show all popular assets immediately
    if (!query) {
      return POPULAR_ASSETS;
    }

    // Match popular assets first
    const matchedPopular = POPULAR_ASSETS.filter((item) => {
      const sym = item.symbol.toLowerCase();
      const name = item.shortname.toLowerCase();
      const desc = getShortDescription(item.symbol, item.shortname).toLowerCase();
      return (
        sym.includes(query) ||
        name.includes(query) ||
        desc.includes(query) ||
        (query.includes('sp500') && (sym.includes('sxr8') || sym.includes('vuaa'))) ||
        (query.includes('semi') && sym.includes('smh')) ||
        (query.includes('google') && sym.includes('goog'))
      );
    });

    const popularSymbols = new Set(matchedPopular.map((i) => i.symbol.toUpperCase()));

    // Add API results that aren't already included in matchedPopular
    const apiMatches = searchResults.filter(
      (item) => !popularSymbols.has(item.symbol.toUpperCase())
    );

    return [...matchedPopular, ...apiMatches];
  }, [searchQuery, searchResults]);

  const totalPercentage = targets.reduce((sum, item) => sum + (Number(item.targetPercent) || 0), 0);
  const isExact100 = Math.abs(totalPercentage - 100) < 0.01;

  // Rebalancing calculation considering current capital
  const calculatedAllocations = useMemo(() => {
    if (amount <= 0) return [];

    const currentTotal = totalValue > 0 ? totalValue : 0;
    const targetTotal = currentTotal + amount;

    // Map each target to its matching position in the portfolio
    const items = targets.map((item) => {
      const matchedPos = findMatchingPosition(item, positions);
      const currentVal = matchedPos ? matchedPos.value || 0 : 0;
      const currentPct = currentTotal > 0 ? (currentVal / currentTotal) * 100 : 0;

      const targetWeight = (Number(item.targetPercent) || 0) / 100;
      const idealFinalValue = targetTotal * targetWeight;
      const deficit = idealFinalValue - currentVal;

      return {
        ...item,
        currentVal,
        currentPct,
        idealFinalValue,
        deficit,
        calculatedAmount: 0,
      };
    });

    if (currentTotal === 0) {
      // If portfolio has no capital yet, distribute strictly by target percentage
      return items.map((it) => ({
        ...it,
        calculatedAmount: (amount * (Number(it.targetPercent) || 0)) / (totalPercentage || 100),
      }));
    }

    // Filter items with positive deficits (assets that are below target)
    const positiveDeficitItems = items.filter((it) => it.deficit > 0);
    const sumPositiveDeficits = positiveDeficitItems.reduce((acc, it) => acc + it.deficit, 0);

    if (sumPositiveDeficits > 0) {
      // Distribute contribution proportionally to deficits
      return items.map((it) => {
        if (it.deficit > 0) {
          const shareOfContribution = (it.deficit / sumPositiveDeficits) * amount;
          return { ...it, calculatedAmount: shareOfContribution };
        }
        return { ...it, calculatedAmount: 0 };
      });
    } else {
      // If all items are on or above target, distribute strictly by target percentage
      return items.map((it) => ({
        ...it,
        calculatedAmount: (amount * (Number(it.targetPercent) || 0)) / (totalPercentage || 100),
      }));
    }
  }, [amount, targets, totalValue, positions, totalPercentage]);

  if (!isOpen) return null;

  const handleAmountSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = parseFloat(amountInput.replace(',', '.'));
    if (!isNaN(clean) && clean > 0) {
      setAmount(clean);
      setStep('results');
    }
  };

  const handlePercentChange = (id: string, newPercentVal: string) => {
    const cleanVal = parseFloat(newPercentVal.replace(',', '.')) || 0;
    setTargets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, targetPercent: Math.max(0, cleanVal) } : t))
    );
  };

  const handleDeleteTarget = (id: string) => {
    setTargets((prev) => prev.filter((t) => t.id !== id));
  };

  const handleResetDefaults = () => {
    setTargets(DEFAULT_ALLOCATION_TARGETS);
  };

  const handleSelectSearchResult = (quote: { symbol: string; shortname: string }) => {
    const rawName = quote.shortname || quote.symbol;
    const cleanName = getShortDescription(quote.symbol, rawName);

    // Check if already in targets
    const existing = targets.find(
      (t) => t.ticker.toUpperCase() === quote.symbol.toUpperCase()
    );

    if (!existing) {
      const newTarget: AllocationTarget = {
        id: `${Date.now()}_${quote.symbol}`,
        ticker: quote.symbol,
        name: cleanName,
        targetPercent: 5,
      };
      setTargets((prev) => [...prev, newTarget]);
    }

    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div
      id="contribution-calculator-backdrop"
      data-no-pull="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-md overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-no-pull="true"
        className="w-full max-w-[400px] bg-white rounded-3xl shadow-2xl border border-slate-100/90 overflow-hidden flex flex-col h-[560px] max-h-[90dvh]"
        onClick={() => {
          setSwipedId(null);
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-2">
            {isSearching ? (
              <button
                type="button"
                onClick={() => {
                  setIsSearching(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 flex items-center justify-center transition-all cursor-pointer mr-0.5"
                title="Voltar"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
                <Calculator className="w-4 h-4" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-bold text-slate-800 tracking-tight">
                {isSearching ? 'Adicionar Ação' : 'Calculadora de Aportes'}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">
                {isSearching ? 'Pesquisa por ticker ou nome' : 'Rebalanceamento com base no capital'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Input Amount */}
        {step === 'input_amount' && (
          <form onSubmit={handleAmountSubmit} className="p-6 flex flex-col justify-between flex-1">
            <div className="text-center pt-3 flex flex-col gap-2">
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                Qual o valor do aporte?
              </h3>
              <p className="text-xs text-slate-500">
                {totalValue > 0
                  ? `Capital atual em carteira: ${totalValue.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €`
                  : 'Insere o valor para calcular a distribuição pelas tuas ações.'}
              </p>
            </div>

            <div className="relative flex items-center justify-center my-auto">
              <span className="absolute left-4 text-2xl font-bold text-slate-400">€</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0"
                autoFocus={false}
                className="w-full text-center text-3xl font-extrabold text-slate-900 bg-slate-50 border border-slate-200 focus:border-sky-500 focus:bg-white rounded-2xl py-4 pl-10 pr-6 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={!amountInput || parseFloat(amountInput) <= 0}
              className="w-full py-4 px-5 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-bold text-sm tracking-wide shadow-md shadow-sky-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-auto"
            >
              <span>Calcular Aporte</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* Step 2: Distribution List or Full Search View */}
        {step === 'results' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* View A: Full-Size Search View when adding a stock */}
            {isSearching ? (
              <div className="flex-1 flex flex-col p-4 overflow-hidden gap-3">
                <div className="relative flex items-center shrink-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Pesquisar (ex: NVDA, BTC, Apple)..."
                    autoFocus
                    className="w-full text-[16px] font-medium bg-slate-50 border border-slate-200 focus:border-sky-500 focus:bg-white rounded-2xl py-3 pl-10 pr-10 outline-none shadow-2xs transition-all"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Results Container - Large and spacious */}
                <div className="flex-1 overflow-y-auto bg-slate-50/50 border border-slate-200/80 rounded-2xl divide-y divide-slate-100 p-1">
                  {!searchQuery.trim() && (
                    <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Ações e ETFs Mais Populares
                    </div>
                  )}

                  {displayedSearchResults.length > 0 && (
                    displayedSearchResults.map((item) => (
                      <button
                        key={item.symbol}
                        type="button"
                        onClick={() => handleSelectSearchResult(item)}
                        className="w-full px-4 py-3 text-left hover:bg-sky-50/80 active:bg-sky-100 rounded-xl flex items-center justify-between gap-3 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-bold text-slate-800 block truncate">
                            {getShortDescription(item.symbol, item.shortname)}
                          </span>
                          <span className="text-xs text-slate-400 font-semibold uppercase">
                            {item.symbol} {item.exchange ? `• ${item.exchange}` : ''}
                          </span>
                        </div>
                        <div className="w-7 h-7 rounded-full bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0">
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                        </div>
                      </button>
                    ))
                  )}

                  {isSearchLoading && (
                    <div className="py-4 text-center text-xs font-semibold text-slate-400">
                      A carregar mais resultados em tempo real...
                    </div>
                  )}

                  {!isSearchLoading && searchQuery.trim() && displayedSearchResults.length === 0 && (
                    <div className="py-12 text-center text-xs font-medium text-slate-400">
                      Nenhuma ação encontrada para "{searchQuery}"
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* View B: Distribution List & Management */
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Summary Top Bar */}
                <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Aporte Total
                    </span>
                    <span className="text-lg font-black text-slate-900">
                      {amount.toLocaleString('pt-PT', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      €
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStep('input_amount')}
                      className="px-2.5 py-1 text-xs font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-lg transition-colors cursor-pointer"
                    >
                      Alterar valor
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDefaults}
                      title="Restaurar predefinições"
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Warning if percentages don't add up to 100% */}
                {!isExact100 && (
                  <div className="mx-4 my-2 px-3 py-1.5 bg-amber-50 border border-amber-200/70 rounded-xl flex items-center gap-2 text-amber-800 text-[11px] shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Total das metas: <strong>{totalPercentage.toFixed(1)}%</strong> (deve somar 100%)
                    </span>
                  </div>
                )}

                {/* List of Allocation Targets with Swipe Left actions */}
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                  {calculatedAllocations.map((item) => (
                    <SwipeableTargetItem
                      key={item.id}
                      item={item}
                      totalValue={totalValue}
                      onDelete={handleDeleteTarget}
                      onPercentChange={handlePercentChange}
                      isOpenedId={swipedId}
                      setIsOpenedId={setSwipedId}
                    />
                  ))}
                </div>

                {/* Add new stock button */}
                <div className="p-3 border-t border-slate-100 bg-slate-50/60 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsSearching(true)}
                    className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-300 hover:border-sky-400 bg-white hover:bg-sky-50/50 text-slate-700 hover:text-sky-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-4 h-4 text-sky-600" />
                    <span>Adicionar outra ação à lista</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
