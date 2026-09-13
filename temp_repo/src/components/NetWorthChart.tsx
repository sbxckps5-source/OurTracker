import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PortfolioPosition, HoldingDoc } from '../types';
import { fetchPortfolioMeta } from '../services/portfolioService';

interface NetWorthChartProps {
  totalValue: number;
  positions: PortfolioPosition[];
  holdings: HoldingDoc[];
}

export type NetWorthTimeRange = '1D' | '1W' | '1M' | '1Y' | 'Max';
export type ChartDisplayMode = 'performance' | 'netWorth';

const TIME_RANGES: { key: NetWorthTimeRange; label: string }[] = [
  { key: '1D', label: '1D' },
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '1Y', label: '1Y' },
  { key: 'Max', label: 'Max' },
];

interface Point {
  timestamp: number;
  val: number;          // Total Net Worth (€)
  contributions: number;// Cumulative Capital Deposited (€)
  gainEur: number;      // Investment Gain/Loss (€)
  twrPercent: number;   // Time-Weighted Return (%)
  dateStr: string;
  isDepositPoint?: boolean;
  depositAmount?: number;
  isMarketOpen?: boolean;
}

interface ChartPoint {
  timestamp: number;
  priceEur: number;
}

export const NetWorthChart: React.FC<NetWorthChartProps> = ({
  totalValue,
  positions,
  holdings,
}) => {
  const [selectedRange, setSelectedRange] = useState<NetWorthTimeRange>('1D');
  const [chartMode, setChartMode] = useState<ChartDisplayMode>('performance');
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeDepositTooltip, setActiveDepositTooltip] = useState<{
    x: number;
    y: number;
    amount: number;
    dateStr: string;
  } | null>(null);

  // Real historical charts mapped by ticker
  const [historicalCharts, setHistoricalCharts] = useState<Record<string, ChartPoint[]>>({});

  // Deposit records
  const [deposits, setDeposits] = useState<Array<{ date: number; amount: number }>>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Fetch deposit metadata from portfolio
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

  // 2. Fetch real historical price series for all holdings when range changes
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const apiRangeMap: Record<NetWorthTimeRange, string> = {
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

  // 3. Combine asset historical prices & deposits using strict TWR (Time-Weighted Return) methodology
  const points = useMemo<Point[]>(() => {
    const now = Date.now();
    const JAN_1_2026 = new Date('2026-01-01T00:00:00.000Z').getTime();

    // Determine range start time
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
      isFlowPoint: boolean;
    }> = [];

    let prevContributions = 0;

    masterTimestamps.forEach((ts, idx) => {
      // 1. Calculate cumulative purchase cost basis & cash flow deposits up to timestamp ts
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

      // 2. Calculate asset valuation at timestamp ts using robust forward-fill price lookups
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

      // Anchor last point to totalValue if present
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
        isFlowPoint: Math.abs(newFlow) > 0.01,
      });
    });

    // 4. Calculate continuous Time-Weighted Return (TWR %) and Net Eur gain across sub-periods
    const result: Point[] = [];
    let cumTwrFactor = 1.0;

    // Find first non-zero net worth index
    const startIdx = Math.max(0, rawTimeline.findIndex((s) => s.netWorth > 0));

    rawTimeline.forEach((step, i) => {
      if (i > startIdx) {
        const prevStep = rawTimeline[i - 1];
        const prevNetWorth = prevStep.netWorth;
        const newFlow = step.newFlow;

        if (prevNetWorth > 0) {
          // Sub-period return eliminating cash deposit/withdrawal jump:
          // R_i = (V_i - CashFlow_i - V_{i-1}) / V_{i-1}
          const subReturn = (step.netWorth - newFlow - prevNetWorth) / prevNetWorth;
          if (!isNaN(subReturn) && isFinite(subReturn)) {
            cumTwrFactor *= 1 + Math.max(-0.5, Math.min(0.5, subReturn));
          }
        }
      }

      const twrPercent = step.netWorth > 0 ? (cumTwrFactor - 1) * 100 : 0;
      const gainEur = step.netWorth > 0 ? step.netWorth - step.contributions : 0;

      const d = new Date(step.timestamp);
      const day = d.getUTCDay();
      const hour = d.getUTCHours();
      const isMarketOpen = day >= 1 && day <= 5 && hour >= 13 && hour <= 20;

      const dateStr = d.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: selectedRange === '1Y' || selectedRange === 'Max' ? 'numeric' : undefined,
        hour: selectedRange === '1D' || selectedRange === '1W' ? '2-digit' : undefined,
        minute: selectedRange === '1D' || selectedRange === '1W' ? '2-digit' : undefined,
      });

      result.push({
        timestamp: step.timestamp,
        val: step.netWorth,
        contributions: step.contributions,
        gainEur,
        twrPercent,
        dateStr,
        isDepositPoint: step.isFlowPoint,
        depositAmount: step.newFlow,
        isMarketOpen,
      });
    });

    return result;
  }, [selectedRange, historicalCharts, deposits, holdings, positions, totalValue]);

  // Active point when scrubbing with inspection line
  const activeIndex = scrubIndex !== null ? scrubIndex : points.length - 1;
  const activePoint = points[activeIndex] || points[points.length - 1] || {
    val: totalValue > 0 ? totalValue : 0,
    contributions: 0,
    gainEur: 0,
    twrPercent: 0,
    dateStr: 'Hoje',
  };

  const displayedNetWorth = activePoint.val;
  const displayedContributions = activePoint.contributions;
  const displayedGainEur = activePoint.gainEur;
  const twrPercent = activePoint.twrPercent;
  const isGainPositive = displayedGainEur >= 0;
  const isReturnPositive = twrPercent >= 0;

  // Chart Metric Y-values depending on selected display mode
  const chartYValues = useMemo(() => {
    if (points.length === 0) return [0];
    return points.map((p) => (chartMode === 'performance' ? p.twrPercent : p.val));
  }, [points, chartMode]);

  const minVal = useMemo(() => Math.min(...chartYValues), [chartYValues]);
  const maxVal = useMemo(() => Math.max(...chartYValues), [chartYValues]);
  const valRange = maxVal - minVal || 1;

  // SVG dimensions & path building
  const svgWidth = 360;
  const svgHeight = 200;
  const paddingY = 24;

  const coordinates = useMemo(() => {
    if (points.length === 0) return [];
    return points.map((p, i) => {
      const x = (i / (points.length - 1)) * svgWidth;
      const metricVal = chartMode === 'performance' ? p.twrPercent : p.val;
      const normalizedY = (metricVal - minVal) / valRange;
      const y = svgHeight - paddingY - normalizedY * (svgHeight - 2 * paddingY);
      return { x, y, point: p, metricVal };
    });
  }, [points, chartMode, minVal, valRange]);

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

  // Deposit markers coordinates
  const depositMarkers = useMemo(() => {
    return coordinates.filter((c) => c.point.isDepositPoint && Math.abs(c.point.depositAmount || 0) > 0.01);
  }, [coordinates]);

  // Pointer scrubbing handlers
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
    setActiveDepositTooltip(null);
  };

  return (
    <div className="w-full bg-white flex flex-col pt-3 pb-4">
      {/* Mode Selector & Header */}
      <div className="px-5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Dashboard de Performance
        </span>

        {/* Chart View Toggle: Performance % vs Net Worth € */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
          <button
            type="button"
            onClick={() => setChartMode('performance')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              chartMode === 'performance'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Performance (%)
          </button>
          <button
            type="button"
            onClick={() => setChartMode('netWorth')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              chartMode === 'netWorth'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Net Worth (€)
          </button>
        </div>
      </div>

      {/* 4-Metric Grid Cards */}
      <div className="px-5 mt-4 grid grid-cols-2 gap-3">
        {/* Card 1: Total Net Worth */}
        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500">Total Net Worth</span>
          <span className="text-xl font-extrabold text-slate-900 mt-1">
            €{displayedNetWorth.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium text-slate-400 mt-0.5">Valor atual da carteira</span>
        </div>

        {/* Card 2: Total Contributions */}
        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500">Total Contribuído</span>
          <span className="text-xl font-extrabold text-slate-900 mt-1">
            €{displayedContributions.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] font-medium text-slate-400 mt-0.5">Capital investido líquido</span>
        </div>

        {/* Card 3: Investment Gain/Loss */}
        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500">Ganho/Perda Ativos</span>
          <span
            className={`text-xl font-extrabold mt-1 ${
              isGainPositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {isGainPositive ? '+' : ''}€{displayedGainEur.toFixed(2)}
          </span>
          <span className="text-[10px] font-medium text-slate-400 mt-0.5">Lucro gerado pelo mercado</span>
        </div>

        {/* Card 4: Return % (TWR) */}
        <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-slate-500">Retorno TWR (%)</span>
          <span
            className={`text-xl font-extrabold mt-1 flex items-center gap-1 ${
              isReturnPositive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            <span>{isReturnPositive ? '↗' : '↘'}</span>
            <span>{twrPercent.toFixed(2)}%</span>
          </span>
          <span className="text-[10px] font-medium text-slate-400 mt-0.5">Performance sem depósitos</span>
        </div>
      </div>

      {/* SVG Interactive Chart */}
      <div className="relative w-full h-[200px] mt-4 touch-none select-none">
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
          {/* Main Trend Line */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={
                chartMode === 'performance'
                  ? isReturnPositive
                    ? '#10b981'
                    : '#f43f5e'
                  : '#2563eb'
              }
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Deposit / Withdrawal Markers on Chart Line */}
          {depositMarkers.map((marker, idx) => {
            const isDeposit = (marker.point.depositAmount || 0) > 0;
            return (
              <g
                key={`dep-${idx}`}
                className="cursor-pointer"
                onMouseEnter={() =>
                  setActiveDepositTooltip({
                    x: marker.x,
                    y: marker.y,
                    amount: marker.point.depositAmount || 0,
                    dateStr: marker.point.dateStr,
                  })
                }
                onMouseLeave={() => setActiveDepositTooltip(null)}
                onClick={() =>
                  setActiveDepositTooltip((prev) =>
                    prev ? null : {
                      x: marker.x,
                      y: marker.y,
                      amount: marker.point.depositAmount || 0,
                      dateStr: marker.point.dateStr,
                    }
                  )
                }
              >
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="6"
                  fill={isDeposit ? '#10b981' : '#f43f5e'}
                  fillOpacity="0.25"
                  className="animate-pulse"
                />
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="3.5"
                  fill={isDeposit ? '#10b981' : '#f43f5e'}
                  stroke="#ffffff"
                  strokeWidth="1.2"
                />
              </g>
            );
          })}

          {/* Vertical Inspection Line (when scrubbing) */}
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
                r="4.5"
                fill={
                  chartMode === 'performance'
                    ? isReturnPositive
                      ? '#10b981'
                      : '#f43f5e'
                    : '#2563eb'
                }
                stroke="#ffffff"
                strokeWidth="2"
                className="shadow-sm"
              />
            </g>
          )}
        </svg>

        {/* Deposit Tooltip Badge */}
        {activeDepositTooltip && (
          <div
            className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg shadow-sm z-30 flex items-center gap-1 whitespace-nowrap"
            style={{
              left: `${(activeDepositTooltip.x / svgWidth) * 100}%`,
              top: `${(activeDepositTooltip.y / svgHeight) * 100}%`,
            }}
          >
            <span>{activeDepositTooltip.amount >= 0 ? 'Depósito:' : 'Levantamento:'}</span>
            <span>
              {activeDepositTooltip.amount >= 0 ? '+' : ''}€
              {activeDepositTooltip.amount.toFixed(2)}
            </span>
          </div>
        )}

        {/* Date Tooltip above vertical line when scrubbing */}
        {activeCoord && scrubIndex !== null && !activeDepositTooltip && (
          <div
            className="absolute pointer-events-none transform -translate-x-1/2 top-1 text-[11px] font-semibold text-slate-600 bg-white/95 px-2.5 py-0.5 rounded-md shadow-xs border border-slate-100 backdrop-blur-xs z-10 flex items-center gap-1.5 whitespace-nowrap"
            style={{
              left: `${(activeCoord.x / svgWidth) * 100}%`,
            }}
          >
            <span>{activePoint.dateStr}</span>
            {chartMode === 'performance' ? (
              <span className="text-[10px] font-bold text-slate-800">
                {activePoint.twrPercent >= 0 ? '+' : ''}
                {activePoint.twrPercent.toFixed(2)}%
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-800">
                €{activePoint.val.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Time Range Selector (1D, 1W, 1M, 1Y, Max) */}
      <div className="px-5 mt-4">
        <div className="flex items-center justify-between gap-1">
          {TIME_RANGES.map((r) => {
            const isActive = selectedRange === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setSelectedRange(r.key);
                  setScrubIndex(null);
                  setActiveDepositTooltip(null);
                }}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-full transition-all cursor-pointer text-center ${
                  isActive
                    ? 'bg-sky-100 text-sky-700 font-bold'
                    : 'text-slate-400 hover:text-slate-600 active:scale-95'
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

