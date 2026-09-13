import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PortfolioPosition, HoldingDoc, DailySnapshotDoc } from '../types';
import { subscribeDailySnapshots } from '../services/portfolioService';

interface HomeTabProps {
  totalValue?: number;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
  onSyncComplete?: () => void;
  resetSignal?: number;
}

type TimeRange = '1D' | '1S' | '1M' | '3M' | '1A' | 'Tudo';

interface ChartPoint {
  timestamp: number;
  value: number;
  dateStr: string;
  changePercent: number;
  changeEur: number;
}

// Gerador de curva Bézier suave (Catmull-Rom para Bézier cúbica)
function generateSmoothSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  const tension = 0.18;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  totalValue = 0,
  positions = [],
  holdings = [],
  resetSignal,
}) => {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1M');
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<DailySnapshotDoc[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Escutar a subcoleção dailySnapshots no Firestore
  useEffect(() => {
    const unsub = subscribeDailySnapshots('main', (data) => {
      setSnapshots(data);
    });
    return () => unsub();
  }, []);

  // Resetar crosshair se houver resetSignal
  useEffect(() => {
    if (resetSignal) {
      setActivePointIndex(null);
    }
  }, [resetSignal]);

  // 1. Calcular a data da primeira compra em todas as holdings
  const earliestPurchaseTimestamp = useMemo(() => {
    let earliest = Date.now();
    let found = false;

    holdings.forEach((h) => {
      if (h.createdAt && h.createdAt < earliest) {
        earliest = h.createdAt;
        found = true;
      }
      if (h.purchases && Array.isArray(h.purchases)) {
        h.purchases.forEach((p) => {
          const pDate = typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || 0);
          if (pDate > 0 && pDate < earliest) {
            earliest = pDate;
            found = true;
          }
        });
      }
    });

    return found ? earliest : Date.now() - 30 * 24 * 60 * 60 * 1000;
  }, [holdings]);

  // 2. Filtrar e formatar pontos do gráfico com base no intervalo selecionado
  const chartPoints = useMemo(() => {
    const now = Date.now();
    const currentVal = totalValue > 0 ? totalValue : 0;

    // Calcular total investido atual a partir dos holdings
    let totalInvestedCurrent = 0;
    holdings.forEach((h) => {
      const purchases = Array.isArray(h.purchases) ? h.purchases : [];
      purchases.forEach((p) => {
        const shares = Number(p.shares || 0);
        const price = Number(p.priceEur ?? p.price ?? 0);
        if (shares > 0 && price > 0) {
          totalInvestedCurrent += shares * price;
        }
      });
    });

    if (totalInvestedCurrent === 0 && currentVal > 0) {
      totalInvestedCurrent = currentVal;
    }

    // Caso A: Modo 1D (curva fluida suave entre ontem e o valor em tempo real de hoje)
    if (selectedRange === '1D') {
      const yesterdaySnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
      const startVal =
        yesterdaySnap?.totalValue && yesterdaySnap.totalValue > 0
          ? yesterdaySnap.totalValue
          : currentVal > 0
          ? currentVal * 0.994
          : 1000;

      const pointCount = 20;
      const points: ChartPoint[] = [];
      const startTime = now - 24 * 60 * 60 * 1000;

      for (let i = 0; i < pointCount; i++) {
        const progress = i / (pointCount - 1 || 1);
        const t = startTime + progress * (now - startTime);
        const organicNoise = Math.sin(i * 0.9) * (startVal * 0.0025) * (1 - progress);
        const val =
          i === pointCount - 1
            ? currentVal
            : Math.max(0, startVal + (currentVal - startVal) * progress + organicNoise);

        const diffFromStart = val - startVal;
        const changePct = startVal > 0 ? (diffFromStart / startVal) * 100 : 0;
        const timeStr = new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

        points.push({
          timestamp: t,
          value: Number(val.toFixed(2)),
          dateStr: `Hoje, ${timeStr}`,
          changePercent: Number(changePct.toFixed(2)),
          changeEur: Number(diffFromStart.toFixed(2)),
        });
      }

      return points;
    }

    // Caso B: Períodos históricos (1S, 1M, 3M, 1A, Tudo)
    let startTime = now;
    switch (selectedRange) {
      case '1S':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '1M':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case '3M':
        startTime = now - 90 * 24 * 60 * 60 * 1000;
        break;
      case '1A':
        startTime = now - 365 * 24 * 60 * 60 * 1000;
        break;
      case 'Tudo':
        startTime = earliestPurchaseTimestamp - 30 * 24 * 60 * 60 * 1000;
        break;
    }

    const filteredSnapshots = snapshots.filter((s) => {
      const snapTime = s.timestamp || new Date(s.date).getTime();
      return snapTime >= startTime;
    });

    if (filteredSnapshots.length > 0) {
      const points: ChartPoint[] = filteredSnapshots.map((s) => {
        const val = s.totalValue;
        const invested = s.totalInvested || val;
        const diff = s.diffEur !== undefined ? s.diffEur : val - invested;
        const pct =
          s.returnPercent !== undefined ? s.returnPercent : invested > 0 ? (diff / invested) * 100 : 0;

        const dateObj = new Date(s.timestamp || s.date);
        const formattedDate = dateObj.toLocaleDateString('pt-PT', {
          day: '2-digit',
          month: 'short',
          year: selectedRange === '1A' || selectedRange === 'Tudo' ? 'numeric' : undefined,
        });

        return {
          timestamp: s.timestamp || dateObj.getTime(),
          value: Number(val.toFixed(2)),
          dateStr: formattedDate,
          changePercent: Number(pct.toFixed(2)),
          changeEur: Number(diff.toFixed(2)),
        };
      });

      // Anexar o ponto atual em tempo real no final
      const lastPoint = points[points.length - 1];
      const todayDateStr = new Date().toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: selectedRange === '1A' || selectedRange === 'Tudo' ? 'numeric' : undefined,
      });

      if (lastPoint && currentVal > 0 && Math.abs(lastPoint.value - currentVal) > 0.01) {
        const currentDiff = currentVal - totalInvestedCurrent;
        const currentPct = totalInvestedCurrent > 0 ? (currentDiff / totalInvestedCurrent) * 100 : 0;
        points.push({
          timestamp: now,
          value: Number(currentVal.toFixed(2)),
          dateStr: `${todayDateStr} (Agora)`,
          changePercent: Number(currentPct.toFixed(2)),
          changeEur: Number(currentDiff.toFixed(2)),
        });
      }

      return points;
    }

    // Se ainda não houver dados no Firestore, gerar curva simulada suave
    const simulatedPointsCount = selectedRange === '1S' ? 8 : selectedRange === '1M' ? 25 : 40;
    const points: ChartPoint[] = [];
    const baseVal = currentVal > 0 ? currentVal : 1000;
    const startVal = totalInvestedCurrent > 0 ? totalInvestedCurrent : baseVal * 0.92;

    for (let i = 0; i < simulatedPointsCount; i++) {
      const progress = i / (simulatedPointsCount - 1 || 1);
      const timestamp = startTime + progress * (now - startTime);
      const noise = Math.sin(i * 0.7) * (baseVal * 0.012) * (1 - progress);
      const val =
        i === simulatedPointsCount - 1
          ? currentVal
          : Math.max(10, startVal + (baseVal - startVal) * progress + noise);

      const diff = val - startVal;
      const pct = startVal > 0 ? (diff / startVal) * 100 : 0;

      const dateObj = new Date(timestamp);
      const formattedDate = dateObj.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: selectedRange === '1A' || selectedRange === 'Tudo' ? 'numeric' : undefined,
      });

      points.push({
        timestamp,
        value: Number(val.toFixed(2)),
        dateStr: formattedDate,
        changePercent: Number(pct.toFixed(2)),
        changeEur: Number(diff.toFixed(2)),
      });
    }

    return points;
  }, [selectedRange, totalValue, holdings, earliestPurchaseTimestamp, snapshots]);

  // Ponto ativo: se estiver a arrastar o dedo, mostra o ponto sob o cursor; senão o último ponto
  const latestPoint = chartPoints[chartPoints.length - 1] || {
    value: totalValue,
    dateStr: '',
    changePercent: 0,
    changeEur: 0,
  };

  const activePoint =
    activePointIndex !== null && chartPoints[activePointIndex]
      ? chartPoints[activePointIndex]
      : latestPoint;

  const isScrubbing = activePointIndex !== null;

  // Dimensões do SVG
  const width = 360;
  const height = 190;
  const paddingX = 4;
  const paddingTop = 14;
  const paddingBottom = 14;

  const values = chartPoints.map((p) => p.value);
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 100;
  const valRange = maxVal - minVal || (maxVal > 0 ? maxVal * 0.1 : 1);

  const getX = (index: number) => {
    if (chartPoints.length <= 1) return width / 2;
    return paddingX + (index / (chartPoints.length - 1)) * (width - paddingX * 2);
  };

  const getY = (val: number) => {
    return height - paddingBottom - ((val - minVal) / valRange) * (height - paddingTop - paddingBottom);
  };

  // Coordenadas para a curva Bézier suave
  const coordinates = chartPoints.map((pt, idx) => ({
    x: getX(idx),
    y: getY(pt.value),
  }));

  const smoothPathD = generateSmoothSvgPath(coordinates);
  const areaD = coordinates.length > 0
    ? `${smoothPathD} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(height - paddingBottom).toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${(height - paddingBottom).toFixed(2)} Z`
    : '';

  // Interação de toque / arrasto (Crosshair)
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartPoints.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xPos = e.clientX - rect.left;
    const svgX = (xPos / rect.width) * width;

    let closestIdx = 0;
    let minDst = Infinity;
    chartPoints.forEach((_, idx) => {
      const ptX = getX(idx);
      const dst = Math.abs(ptX - svgX);
      if (dst < minDst) {
        minDst = dst;
        closestIdx = idx;
      }
    });

    setActivePointIndex(closestIdx);
  };

  const handlePointerLeave = () => {
    setActivePointIndex(null);
  };

  const isPositiveReturn = activePoint.changePercent >= 0;

  return (
    <div id="home-tab-container" className="w-full flex-1 flex flex-col px-5 pt-3 pb-8 bg-white select-none">
      {/* 1. Cabeçalho Superior: Valor Total em Destaque & Rentabilidade */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex flex-col">
          <span className="text-3xl font-black text-slate-900 tracking-tight tabular-nums">
            €{activePoint.value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {/* Mostra a data correspondente dinamicamente quando o utilizador toca no gráfico */}
          <span className="text-xs font-semibold text-slate-400 mt-0.5 h-4 transition-all">
            {isScrubbing ? activePoint.dateStr : ''}
          </span>
        </div>

        <div className="flex flex-col items-end">
          <span
            className={`text-sm font-black tabular-nums flex items-center gap-0.5 ${
              isPositiveReturn ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {isPositiveReturn ? '↗' : '↘'}
            {isPositiveReturn ? '+' : ''}
            {activePoint.changePercent.toFixed(2)}%
          </span>
          <span
            className={`text-xs font-bold tabular-nums mt-0.5 ${
              isPositiveReturn ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {isPositiveReturn ? '+' : ''}€{activePoint.changeEur.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* 2. Gráfico Sparkline Simples em Linha Azul Fluida com Crosshair Vertical */}
      <div className="w-full relative my-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-52 overflow-visible cursor-crosshair touch-none"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerUp={handlePointerLeave}
        >
          <defs>
            <linearGradient id="homeBlueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Área com gradiente azul suave */}
          {areaD && <path d={areaD} fill="url(#homeBlueGradient)" />}

          {/* Linha Principal do Gráfico (AZUL #2563EB - curva suave Bézier, sem eixos, sem grelha, sem linha horizontal de fundo) */}
          {smoothPathD && (
            <path
              d={smoothPathD}
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Crosshair Interativo: Linha Vertical Tracejada que segue o dedo ao longo da curva */}
          {activePointIndex !== null && (
            <g>
              <line
                x1={getX(activePointIndex)}
                y1={paddingTop}
                x2={getX(activePointIndex)}
                y2={height - paddingBottom}
                stroke="#64748B"
                strokeWidth="1.25"
                strokeDasharray="4 4"
              />
              {/* Ponto azul com contorno branco sobre a linha no cruzamento */}
              <circle
                cx={getX(activePointIndex)}
                cy={getY(activePoint.value)}
                r="5.5"
                fill="#2563EB"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                className="shadow-md"
              />
            </g>
          )}
        </svg>
      </div>

      {/* 3. Rodapé do Gráfico: Botão "+ Benchmark" / "+ Comparar" e Seletor de Período em Português */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        {/* Botão visual '+ Benchmark' sem funcionalidade por agora */}
        <button
          type="button"
          id="btn-benchmark"
          className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
          onClick={(e) => e.preventDefault()}
        >
          <span className="text-sm leading-none">+</span> Benchmark
        </button>

        {/* Seletor de período em português: "1D" | "1S" | "1M" | "3M" | "1A" | "Tudo" */}
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl">
          {(['1D', '1S', '1M', '3M', '1A', 'Tudo'] as TimeRange[]).map((range) => {
            const isActive = selectedRange === range;
            return (
              <button
                key={range}
                id={`btn-range-${range.toLowerCase()}`}
                type="button"
                onClick={() => {
                  setSelectedRange(range);
                  setActivePointIndex(null);
                }}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {range}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
