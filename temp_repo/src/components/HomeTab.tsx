import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PortfolioPosition, HoldingDoc } from '../types';
import { fetchPortfolioMeta } from '../services/portfolioService';

interface HomeTabProps {
  totalValue?: number;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
  onSyncComplete?: () => void;
}

type TimeRange = '1D' | '1W' | '1M' | '1Y' | 'Max';

interface Point {
  timestamp: number;
  val: number;
  contributions: number;
  gainEur: number;
  twrPercent: number;
  dateStr: string;
}

interface ChartPoint {
  timestamp: number;
  priceEur: number;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  totalValue = 0,
  positions = [],
  holdings = [],
}) => {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1D');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [historicalCharts, setHistoricalCharts] = useState<Record<string, ChartPoint[]>>({});
  const [deposits, setDeposits] = useState<Array<{ date: number; amount: number }>>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Fetch deposit metadata
  useEffect(() => {
    let isMounted = true;
    async function loadMeta() {
      try {
        const meta = await fetchPortfolioMeta('main');
        if (isMounted && meta) {
          const parsedDeposits: Array<{ date: number; amount: number }> = [];
          if (Array.isArray(meta.deposits)) {
            meta.deposits.forEach((d: any) => {
              const amount = Number(d.amount || 0);
              let ts = Date.now();
              if (typeof d.date === 'string') {
                const parts = d.date.split('/');
                if (parts.length === 3) {
                  ts = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                } else {
                  ts = new Date(d.date).getTime();
                }
              } else if (typeof d.date === 'number') {
                ts = d.date;
              }
              if (!isNaN(ts) && amount !== 0) {
                parsedDeposits.push({ date: ts, amount });
              }
            });
          }
          setDeposits(parsedDeposits.sort((a, b) => a.date - b.date));
        }
      } catch (err) {
        console.warn('Error loading portfolio meta deposits:', err);
      }
    }
    loadMeta();
    return () => { isMounted = false; };
  }, [positions, holdings, totalValue]);

  // 2. Fetch historical price series
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const apiRangeMap: Record<TimeRange, string> = {
      '1D': '1d',
      '1W': '1w',
      '1M': '1m',
      '1Y': '1y',
      'Max': 'max',
    };
    const rangeParam = apiRangeMap[selectedRange];

    const tickersToFetch = Array.from(
      new Set(
        [...holdings.map((h) => h.ticker), ...positions.map((p) => p.ticker)]
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (tickersToFetch.length === 0) {
      setIsLoading(false);
      return;
    }

    async function fetchAllCharts() {
      const results: Record<string, ChartPoint[]> = {};
      const promises = tickersToFetch.map(async (ticker) => {
        try {
          const res = await fetch(`/api/chart/${encodeURIComponent(ticker)}?range=${rangeParam}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data && Array.isArray(data.points) && data.points.length > 0) {
            results[ticker] = data.points.map((pt: any) => ({
              timestamp: Number(pt.timestamp),
              priceEur: Number(pt.priceEur || pt.price || 0),
            }));
          }
        } catch (err) {
          console.warn(`Failed to fetch chart for ${ticker}:`, err);
        }
      });

      await Promise.all(promises);

      if (isMounted) {
        setHistoricalCharts(results);
        setIsLoading(false);
      }
    }

    fetchAllCharts();

    return () => {
      isMounted = false;
    };
  }, [selectedRange, holdings, positions]);

  // 3. Compute timeline points & TWR performance
  const points = useMemo<Point[]>(() => {
    const now = Date.now();
    const JAN_1_2026 = new Date('2026-01-01T00:00:00.000Z').getTime();

    let startTime = now - 24 * 60 * 60 * 1000;
    if (selectedRange === '1W') startTime = now - 7 * 24 * 60 * 60 * 1000;
    if (selectedRange === '1M') startTime = now - 30 * 24 * 60 * 60 * 1000;
    if (selectedRange === '1Y') startTime = now - 365 * 24 * 60 * 60 * 1000;
    if (selectedRange === 'Max') startTime = JAN_1_2026;

    const numSteps = 45;
    const interval = (now - startTime) / (numSteps - 1);
    const masterTimestamps = Array.from({ length: numSteps }, (_, i) => Math.round(startTime + i * interval));

    const holdingItems = holdings.length > 0
      ? holdings
      : positions.map((p) => ({
          id: p.id,
          ticker: p.ticker,
          shares: p.shares,
          createdAt: JAN_1_2026,
          purchases: [{ id: `p-${p.id}`, date: JAN_1_2026, shares: p.shares, price: p.currentPrice, priceEur: p.currentPrice }],
        }));

    const lastKnownPrices: Record<string, number> = {};
    const rawTimeline: Array<{
      timestamp: number;
      netWorth: number;
      contributions: number;
      newFlow: number;
    }> = [];

    let prevContributions = 0;

    masterTimestamps.forEach((ts, idx) => {
      let purchasesCostAtTs = 0;
      holdingItems.forEach((item) => {
        const normTicker = item.ticker.trim().toUpperCase();
        const matchedPos = positions.find(
          (p) =>
            p.ticker.trim().toUpperCase() === normTicker ||
            p.ticker.trim().toUpperCase() === normTicker.replace(/\.US$/i, '') ||
            normTicker === p.ticker.trim().toUpperCase().replace(/\.US$/i, '')
        );

        let itemPurchases = item.purchases || [];
        if (itemPurchases.length === 0) {
          const fallbackPrice =
            matchedPos?.openPrice ||
            matchedPos?.currentPrice ||
            (matchedPos && matchedPos.shares > 0 ? matchedPos.value / matchedPos.shares : 0) ||
            0;
          itemPurchases = [
            {
              id: 'p-def',
              date: item.createdAt || JAN_1_2026,
              shares: item.shares,
              price: fallbackPrice,
              priceEur: fallbackPrice,
            },
          ];
        }

        itemPurchases.forEach((p) => {
          const pDate = p.date || item.createdAt || JAN_1_2026;
          if (pDate <= ts) {
            const buyUnitPrice =
              p.price ??
              p.priceEur ??
              matchedPos?.openPrice ??
              matchedPos?.currentPrice ??
              (matchedPos && matchedPos.shares > 0 ? matchedPos.value / matchedPos.shares : 0) ??
              0;
            purchasesCostAtTs += p.shares * Number(buyUnitPrice);
          }
        });
      });

      const cumDepositsFromMeta = deposits
        .filter((d) => d.date <= ts)
        .reduce((sum, d) => sum + d.amount, 0);

      const cumulativeContributions = Math.max(cumDepositsFromMeta, purchasesCostAtTs);
      const newFlow = idx === 0 ? cumulativeContributions : cumulativeContributions - prevContributions;
      prevContributions = cumulativeContributions;

      let assetsValuation = 0;
      holdingItems.forEach((item) => {
        const normTicker = item.ticker.trim().toUpperCase();
        const chartPts = historicalCharts[normTicker] || historicalCharts[normTicker.replace(/\.US$/i, '')] || [];

        let activeShares = item.shares;
        if (item.purchases && item.purchases.length > 0) {
          activeShares = item.purchases
            .filter((p) => (p.date ? p.date <= ts : true))
            .reduce((s, p) => s + p.shares, 0);
        }

        if (activeShares <= 0) return;

        let priceAtTs = 0;
        if (chartPts.length > 0) {
          const priorPoints = chartPts.filter((pt) => pt.timestamp <= ts + 3600000);
          if (priorPoints.length > 0) {
            priceAtTs = priorPoints[priorPoints.length - 1].priceEur;
          } else {
            priceAtTs = chartPts[0].priceEur;
          }
        }

        if (priceAtTs > 0) {
          lastKnownPrices[normTicker] = priceAtTs;
        } else if (lastKnownPrices[normTicker]) {
          priceAtTs = lastKnownPrices[normTicker];
        } else {
          const matchedPos = positions.find((p) => p.ticker.toUpperCase() === normTicker);
          priceAtTs = matchedPos?.currentPrice || matchedPos?.openPrice || 0;
        }

        assetsValuation += activeShares * priceAtTs;
      });

      let totalNetWorth = assetsValuation;
      if (idx === masterTimestamps.length - 1 && totalValue > 0) {
        totalNetWorth = totalValue;
      } else if (totalNetWorth === 0 && cumulativeContributions > 0) {
        totalNetWorth = cumulativeContributions;
      }

      rawTimeline.push({
        timestamp: ts,
        netWorth: totalNetWorth,
        contributions: cumulativeContributions,
        newFlow,
      });
    });

    const result: Point[] = [];
    
    // Calculate total exact cost of all open holdings
    const totalInvestedCost = holdingItems.reduce((acc, item) => {
      let cost = 0;
      (item.purchases || []).forEach(p => {
        const pPrice = p.price ?? p.priceEur ?? 0;
        cost += p.shares * pPrice;
      });
      if (cost === 0) {
        const matchedPos = positions.find(p => p.ticker.toUpperCase() === item.ticker.toUpperCase());
        cost += item.shares * (matchedPos?.openPrice || matchedPos?.currentPrice || 1);
      }
      return acc + cost;
    }, 0);

    const currentActualVal = totalValue > 0 ? totalValue : (rawTimeline.length > 0 ? rawTimeline[rawTimeline.length - 1].netWorth : 0);
    const overallRealGain = currentActualVal - totalInvestedCost;
    const overallRealTwr = totalInvestedCost > 0 ? (overallRealGain / totalInvestedCost) * 100 : 0;

    rawTimeline.forEach((step, i) => {
      // Scale points relative to the exact current portfolio gain/loss so it matches the real portfolio stats
      const progressFactor = rawTimeline.length > 1 ? i / (rawTimeline.length - 1) : 1;
      const stepVal = step.netWorth;
      const stepCost = step.contributions > 0 ? step.contributions : (totalInvestedCost || 1);
      
      // If it's the last point, use the exact real values
      const isLast = i === rawTimeline.length - 1;
      const finalVal = isLast && currentActualVal > 0 ? currentActualVal : stepVal;
      const finalCost = isLast && totalInvestedCost > 0 ? totalInvestedCost : stepCost;
      
      const gainEur = finalVal - finalCost;
      const twrPercent = finalCost > 0 ? (gainEur / finalCost) * 100 : 0;

      const d = new Date(step.timestamp);
      const dateStr = d.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: selectedRange === '1Y' || selectedRange === 'Max' ? 'numeric' : undefined,
        hour: selectedRange === '1D' || selectedRange === '1W' ? '2-digit' : undefined,
        minute: selectedRange === '1D' || selectedRange === '1W' ? '2-digit' : undefined,
      });

      result.push({
        timestamp: step.timestamp,
        val: finalVal,
        contributions: finalCost,
        gainEur,
        twrPercent,
        dateStr,
      });
    });

    return result;
  }, [selectedRange, historicalCharts, deposits, holdings, positions, totalValue]);

  const activeIndex = scrubIndex !== null ? scrubIndex : points.length - 1;
  const activePoint = points[activeIndex] || points[points.length - 1] || {
    val: totalValue > 0 ? totalValue : 0,
    contributions: 0,
    gainEur: 0,
    twrPercent: 0,
    dateStr: 'Hoje',
  };

  const displayedVal = activePoint.val;
  const displayedGainEur = activePoint.gainEur;
  const twrPercent = activePoint.twrPercent;
  const isPositive = displayedGainEur >= 0;

  // Chart Y coordinates based on TWR percent (ignoring deposits)
  const chartYValues = useMemo(() => {
    if (points.length === 0) return [0];
    return points.map((p) => p.twrPercent);
  }, [points]);

  const minVal = useMemo(() => Math.min(...chartYValues), [chartYValues]);
  const maxVal = useMemo(() => Math.max(...chartYValues), [chartYValues]);
  const valRange = maxVal - minVal || 1;

  const svgWidth = 360;
  const svgHeight = 220;
  const paddingY = 28;

  const coordinates = useMemo(() => {
    if (points.length === 0) return [];
    return points.map((p, i) => {
      const x = (i / (points.length - 1)) * svgWidth;
      const normalizedY = (p.twrPercent - minVal) / valRange;
      const y = svgHeight - paddingY - normalizedY * (svgHeight - 2 * paddingY);
      return { x, y, point: p };
    });
  }, [points, minVal, valRange]);

  const pathD = useMemo(() => {
    if (coordinates.length === 0) return '';
    return coordinates.reduce((acc, coord, i) => {
      if (i === 0) return `M ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`;
      const prev = coordinates[i - 1];
      const cx1 = prev.x + (coord.x - prev.x) / 2;
      const cy1 = prev.y;
      const cx2 = prev.x + (coord.x - prev.x) / 2;
      const cy2 = coord.y;
      return `${acc} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`;
    }, '');
  }, [coordinates]);

  const activeCoord = coordinates[activeIndex] || null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || coordinates.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, relX / rect.width));
    const closestIdx = Math.round(ratio * (coordinates.length - 1));
    setScrubIndex(closestIdx);
  };

  const handlePointerLeave = () => {
    setScrubIndex(null);
  };

  const timeRanges: { key: TimeRange; label: string }[] = [
    { key: '1D', label: '1D' },
    { key: '1W', label: '1W' },
    { key: '1M', label: '1M' },
    { key: '1Y', label: '1Y' },
    { key: 'Max', label: 'Max' },
  ];

  return (
    <div className="w-full min-h-full bg-white flex flex-col pt-6 pb-8">
      {/* Top Header matching IMG_8111.jpeg */}
      <div className="px-5 flex items-start justify-between">
        {/* Left: Big Portfolio Value */}
        <div className="flex flex-col">
          <div className="text-3xl font-bold tracking-tight text-slate-900 flex items-baseline gap-1">
            <span className="text-xl font-medium text-slate-700">€</span>
            <span>
              {displayedVal.toLocaleString('pt-PT', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          {scrubIndex !== null && (
            <span className="text-[11px] font-medium text-slate-400 mt-0.5">
              {activePoint.dateStr}
            </span>
          )}
        </div>

        {/* Right: Return Percentage & Absolute Gain */}
        <div className="flex flex-col items-end">
          <div
            className={`text-base font-bold flex items-center gap-0.5 ${
              isPositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            <span>{isPositive ? '↗' : '↘'}</span>
            <span>{twrPercent >= 0 ? '+' : ''}{twrPercent.toFixed(2)}%</span>
          </div>
          <div
            className={`text-sm font-semibold mt-0.5 ${
              isPositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {isPositive ? '+' : ''}€{displayedGainEur.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Main Chart Area */}
      <div className="relative w-full h-[220px] mt-6 touch-none select-none">
        {isLoading && (
          <div className="absolute inset-0 z-20 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full overflow-visible cursor-crosshair"
          onPointerDown={handlePointerMove}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerLeave}
          onPointerLeave={handlePointerLeave}
        >
          {/* Horizontal Dashed Baseline at the bottom */}
          <line
            x1="0"
            y1={svgHeight - 12}
            x2={svgWidth}
            y2={svgHeight - 12}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.7"
          />

          {/* Smooth Trend Line */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={isPositive ? '#10b981' : '#f43f5e'}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Vertical Scrub Line */}
          {activeCoord && scrubIndex !== null && (
            <g>
              <line
                x1={activeCoord.x}
                y1="0"
                x2={activeCoord.x}
                y2={svgHeight}
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.85"
              />
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="5"
                fill={isPositive ? '#10b981' : '#f43f5e'}
                stroke="#ffffff"
                strokeWidth="2"
                className="shadow-sm"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Time Range Selector (1D, 1W, 1M, 1Y, Max) */}
      <div className="px-5 mt-6">
        <div className="flex items-center justify-between gap-2">
          {timeRanges.map((r) => {
            const isActive = selectedRange === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setSelectedRange(r.key);
                  setScrubIndex(null);
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer text-center ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
