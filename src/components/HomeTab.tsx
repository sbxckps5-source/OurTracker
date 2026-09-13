import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PortfolioPosition, HoldingDoc, DailySnapshotDoc } from '../types';
import { subscribeDailySnapshots } from '../services/portfolioService';
import { SyncWarningBanner } from './SyncWarningBanner';

interface HomeTabProps {
  totalValue?: number;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
  onSyncComplete?: () => void;
  resetSignal?: number;
}

type TimeRange = '1D' | '1S' | '1M' | '3M' | '6M' | '1A' | 'Tudo';

interface ChartPoint {
  timestamp: number;
  value: number;
  dateStr: string;
  changePercent: number;
  changeEur: number;
}

// Formatação limpa de data (ex: "19 set 2019" ou "19 set")
function formatDisplayDate(dateObj: Date): string {
  const day = dateObj.getDate();
  const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const month = monthNames[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  return `${day} ${month} ${year}`;
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
  const [isBenchmarkActive, setIsBenchmarkActive] = useState<boolean>(false);
  const [benchmarkPoints, setBenchmarkPoints] = useState<{
    timestamp: number;
    changePercent: number;
    close: number;
    simulatedValue?: number;
    totalInvested?: number;
    diffEur?: number;
  }[]>([]);
  const [isBenchmarkLoading, setIsBenchmarkLoading] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Escutar a subcoleção dailySnapshots no Firestore
  useEffect(() => {
    const unsub = subscribeDailySnapshots('main', (data) => {
      setSnapshots(data);
    });
    return () => unsub();
  }, []);

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

  // Calcular total investido atual a partir dos holdings
  const totalInvested = useMemo(() => {
    let invested = 0;
    holdings.forEach((h) => {
      const purchases = Array.isArray(h.purchases) ? h.purchases : [];
      purchases.forEach((p) => {
        const shares = Number(p.shares || 0);
        const price = Number(p.priceEur ?? p.price ?? 0);
        if (shares > 0 && price > 0) {
          invested += shares * price;
        }
      });
    });
    return invested > 0 ? invested : totalValue > 0 ? totalValue : 0;
  }, [holdings, totalValue]);

  // Fetch SXR8.DE benchmark data when benchmark is active or range changes
  useEffect(() => {
    if (!isBenchmarkActive) {
      setBenchmarkPoints([]);
      return;
    }

    let isMounted = true;
    setIsBenchmarkLoading(true);

    // 1. Identificar se tens compras de SXR8.DE nos teus holdings e extrair todas as compras reais
    const sxr8Holding = holdings.find((h) => {
      const t = (h.ticker || '').toUpperCase();
      return t.includes('SXR8') || t.includes('CSPX') || t.includes('VUAA');
    });

    // Criar mapa de preço pago pelo utilizador no SXR8.DE por semana (YYYY-WW ou timestamp aproximado)
    const userSxr8PricesByTime: { timestamp: number; priceEur: number }[] = [];
    if (sxr8Holding && Array.isArray(sxr8Holding.purchases)) {
      sxr8Holding.purchases.forEach((p) => {
        const pDate = typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || 0);
        const price = Number(p.priceEur ?? p.price ?? 0);
        if (price > 0 && pDate > 0) {
          userSxr8PricesByTime.push({ timestamp: pDate, priceEur: price });
        }
      });
      userSxr8PricesByTime.sort((a, b) => a.timestamp - b.timestamp);
    }

    // 2. Extrair todas as compras de TODAS as ações para calcular o total depositado por data
    const allDeposits: { date: number; amountEur: number }[] = [];
    holdings.forEach((h) => {
      const purchases = Array.isArray(h.purchases) ? h.purchases : [];
      purchases.forEach((p) => {
        const pDate = typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || 0);
        const shares = Number(p.shares || 0);
        const price = Number(p.priceEur ?? p.price ?? 0);
        const amount = shares * price;
        if (amount > 0) {
          allDeposits.push({
            date: pDate > 0 ? pDate : h.createdAt || Date.now(),
            amountEur: amount,
          });
        }
      });
    });

    // Se não houver compras detalhadas mas houver totalInvested
    if (allDeposits.length === 0 && totalInvested > 0) {
      allDeposits.push({
        date: earliestPurchaseTimestamp,
        amountEur: totalInvested,
      });
    }

    allDeposits.sort((a, b) => a.date - b.date);

    // Carregar série de cotações do SXR8.DE para calcular o valor de mercado ao longo do tempo
    const rangeParam = selectedRange === '1D' ? '1d' : 'max';
    fetch(`/api/chart/SXR8.DE?range=${rangeParam}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        if (data && Array.isArray(data.points) && data.points.length > 0) {
          const sxr8MarketPoints = data.points
            .map((pt: any) => ({
              timestamp: Number(pt.timestamp),
              price: Number(pt.priceEur ?? pt.price ?? pt.close ?? 0),
            }))
            .filter((pt: any) => !isNaN(pt.price) && pt.price > 0 && !isNaN(pt.timestamp));

          if (sxr8MarketPoints.length === 0) {
            setBenchmarkPoints([]);
            return;
          }

          sxr8MarketPoints.sort((a: any, b: any) => a.timestamp - b.timestamp);
          const currentSxr8Price = sxr8MarketPoints[sxr8MarketPoints.length - 1].price;

          // 3. Para cada depósito semanal/mensal, calcular as ações simuladas de SXR8.DE:
          // Usa o preço que compraste no SXR8.DE nessa data. Se não tiveres compra de SXR8 nessa data, usa a cotação real de mercado do SXR8 nesse dia.
          const simulatedSxr8Purchases = allDeposits.map((dep) => {
            let sxr8PriceOnDate = 0;

            // Procurar se tens compra tua de SXR8 na mesma semana (+- 5 dias)
            const userPriceMatch = userSxr8PricesByTime.find(
              (up) => Math.abs(up.timestamp - dep.date) <= 5 * 24 * 3600 * 1000
            );

            if (userPriceMatch && userPriceMatch.priceEur > 0) {
              sxr8PriceOnDate = userPriceMatch.priceEur;
            } else {
              // Buscar a cotação de fecho do SXR8.DE mais próxima da data
              let bestPt = sxr8MarketPoints[0];
              let minDiff = Infinity;
              for (const pt of sxr8MarketPoints) {
                const diff = Math.abs(pt.timestamp - dep.date);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestPt = pt;
                }
              }
              sxr8PriceOnDate = bestPt.price;
            }

            const simulatedShares = sxr8PriceOnDate > 0 ? dep.amountEur / sxr8PriceOnDate : 0;
            return {
              date: dep.date,
              amountEur: dep.amountEur,
              shares: simulatedShares,
              pricePaid: sxr8PriceOnDate,
            };
          });

          // Total acumulado de ações simuladas de SXR8.DE
          const totalAccumShares = simulatedSxr8Purchases.reduce((sum, p) => sum + p.shares, 0);
          const totalAccumInvested = simulatedSxr8Purchases.reduce((sum, p) => sum + p.amountEur, 0);

          // 4. Mapear pontos para a curva do gráfico correspondente ao período atual
          if (selectedRange === '1D') {
            // Em 1D, calcular variação desde o fecho anterior até agora
            const prevClose = data.previousCloseEur || data.previousClose || (sxr8MarketPoints[0]?.price ?? currentSxr8Price);
            const startVal = totalAccumShares > 0 ? totalAccumShares * prevClose : totalInvested;
            const endVal = totalAccumShares > 0 ? totalAccumShares * currentSxr8Price : totalInvested;

            const pointCount = chartPoints.length > 0 ? chartPoints.length : 20;
            const now = Date.now();
            const startTime = now - 24 * 3600 * 1000;

            const dayPoints = [];
            for (let i = 0; i < pointCount; i++) {
              const progress = i / (pointCount - 1 || 1);
              const t = startTime + progress * (now - startTime);
              const val = startVal + (endVal - startVal) * progress;
              const diffEur = val - totalAccumInvested;
              const pct = totalAccumInvested > 0 ? (diffEur / totalAccumInvested) * 100 : 0;

              dayPoints.push({
                timestamp: t,
                close: currentSxr8Price,
                simulatedValue: Number(val.toFixed(2)),
                totalInvested: Number(totalAccumInvested.toFixed(2)),
                diffEur: Number(diffEur.toFixed(2)),
                changePercent: Number(pct.toFixed(2)),
              });
            }

            setBenchmarkPoints(dayPoints);
          } else {
            // Para 1S, 1M, 3M, 6M, 1A, Tudo:
            const chartStartTime = chartPoints[0]?.timestamp || (Date.now() - 30 * 24 * 3600 * 1000);
            let filteredSxr8Points = sxr8MarketPoints.filter(
              (pt: any) => pt.timestamp >= chartStartTime - 24 * 3600 * 1000
            );

            if (filteredSxr8Points.length === 0) {
              filteredSxr8Points = sxr8MarketPoints.slice(-30);
            }

            const mapped = filteredSxr8Points.map((pt: any) => {
              let accumShares = 0;
              let accumInvested = 0;

              simulatedSxr8Purchases.forEach((sp) => {
                if (sp.date <= pt.timestamp + 12 * 3600 * 1000) {
                  accumShares += sp.shares;
                  accumInvested += sp.amountEur;
                }
              });

              if (accumInvested === 0 && simulatedSxr8Purchases.length > 0) {
                accumShares = simulatedSxr8Purchases[0].shares;
                accumInvested = simulatedSxr8Purchases[0].amountEur;
              }

              const simulatedValue = accumShares * pt.price;
              const diffEur = simulatedValue - accumInvested;
              const pct = accumInvested > 0 ? (diffEur / accumInvested) * 100 : 0;

              return {
                timestamp: pt.timestamp,
                close: pt.price,
                simulatedValue: Number(simulatedValue.toFixed(2)),
                totalInvested: Number(accumInvested.toFixed(2)),
                diffEur: Number(diffEur.toFixed(2)),
                changePercent: isNaN(pct) ? 0 : Number(pct.toFixed(2)),
              };
            });

            setBenchmarkPoints(mapped);
          }
        } else {
          setBenchmarkPoints([]);
        }
      })
      .catch((err) => {
        console.error('Error fetching SXR8.DE benchmark:', err);
        if (isMounted) setBenchmarkPoints([]);
      })
      .finally(() => {
        if (isMounted) setIsBenchmarkLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isBenchmarkActive, selectedRange, holdings, totalInvested]);

  // Resetar crosshair se houver resetSignal
  useEffect(() => {
    if (resetSignal) {
      setActivePointIndex(null);
    }
  }, [resetSignal]);

  // 2. Filtrar e formatar pontos do gráfico com base no intervalo selecionado
  const chartPoints = useMemo(() => {
    const now = Date.now();
    const currentVal = totalValue > 0 ? totalValue : 0;
    const totalInvestedCurrent = totalInvested;

    // Caso A: Modo 1D (evolução real do portfólio desde o fecho do dia anterior até ao valor atual)
    if (selectedRange === '1D') {
      const yesterdaySnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
      
      // Calcular valor de fecho anterior real a partir das posições
      let calculatedYesterdayVal = 0;
      positions.forEach((p) => {
        if (!p.isError && p.previousValue !== undefined && p.previousValue > 0) {
          calculatedYesterdayVal += p.previousValue;
        } else if (!p.isError && p.value > 0) {
          calculatedYesterdayVal += p.value;
        }
      });

      const startVal =
        calculatedYesterdayVal > 0
          ? calculatedYesterdayVal
          : yesterdaySnap?.totalValue && yesterdaySnap.totalValue > 0
          ? yesterdaySnap.totalValue
          : currentVal > 0
          ? currentVal
          : 1000;

      const pointCount = 20;
      const points: ChartPoint[] = [];
      const startTime = now - 24 * 60 * 60 * 1000;

      for (let i = 0; i < pointCount; i++) {
        const progress = i / (pointCount - 1 || 1);
        const t = startTime + progress * (now - startTime);
        const val =
          i === pointCount - 1
            ? currentVal
            : startVal + (currentVal - startVal) * progress;

        const diffFromStart = val - startVal;
        const changePct = startVal > 0 ? (diffFromStart / startVal) * 100 : 0;
        const formattedDate = formatDisplayDate(new Date(t));

        points.push({
          timestamp: t,
          value: Number(val.toFixed(2)),
          dateStr: formattedDate,
          changePercent: Number(changePct.toFixed(2)),
          changeEur: Number(diffFromStart.toFixed(2)),
        });
      }

      return points;
    }

    // Caso B: Períodos históricos (1S, 1M, 3M, 6M, 1A, Tudo)
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
      case '6M':
        startTime = now - 180 * 24 * 60 * 60 * 1000;
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
        const formattedDate = formatDisplayDate(dateObj);

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
      const todayDateStr = formatDisplayDate(new Date());

      if (lastPoint && currentVal > 0 && Math.abs(lastPoint.value - currentVal) > 0.01) {
        const currentDiff = currentVal - totalInvestedCurrent;
        const currentPct = totalInvestedCurrent > 0 ? (currentDiff / totalInvestedCurrent) * 100 : 0;
        points.push({
          timestamp: now,
          value: Number(currentVal.toFixed(2)),
          dateStr: todayDateStr,
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
      const formattedDate = formatDisplayDate(dateObj);

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
  const paddingTop = isBenchmarkActive ? 22 : 14;
  const paddingBottom = isBenchmarkActive ? 22 : 14;

  const firstPortVal = chartPoints[0]?.value || 1;

  // Calcular limites verticais combinados (Portfolio + Benchmark) com margem de zoom-out
  const { minVal, maxVal, valRange } = useMemo(() => {
    const portfolioValues = chartPoints.map((p) => p.value);
    let allMin = portfolioValues.length ? Math.min(...portfolioValues) : 0;
    let allMax = portfolioValues.length ? Math.max(...portfolioValues) : 100;

    if (isBenchmarkActive && benchmarkPoints.length > 0) {
      const benchmarkSimulatedValues = benchmarkPoints.map((bp) =>
        bp.simulatedValue !== undefined && bp.simulatedValue > 0
          ? bp.simulatedValue
          : firstPortVal * (1 + (bp.changePercent || 0) / 100)
      );
      const bMin = Math.min(...benchmarkSimulatedValues);
      const bMax = Math.max(...benchmarkSimulatedValues);

      allMin = Math.min(allMin, bMin);
      allMax = Math.max(allMax, bMax);
    }

    let diff = allMax - allMin;
    if (diff <= 0) diff = allMax > 0 ? allMax * 0.1 : 1;

    // Adicionar margem de folga vertical (Zoom-Out) quando o benchmark está ativo
    const marginFactor = isBenchmarkActive ? 0.18 : 0.05;
    const paddedMin = Math.max(0, allMin - diff * marginFactor);
    const paddedMax = allMax + diff * marginFactor;
    const finalRange = paddedMax - paddedMin || 1;

    return {
      minVal: paddedMin,
      maxVal: paddedMax,
      valRange: finalRange,
    };
  }, [chartPoints, benchmarkPoints, isBenchmarkActive, firstPortVal]);

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

  // Calcular curva Bézier para o Benchmark SXR8.DE mapeado na mesma escala e janela temporal
  const benchmarkCoordinates = useMemo(() => {
    if (!isBenchmarkActive || benchmarkPoints.length === 0 || chartPoints.length === 0) return [];

    return benchmarkPoints.map((bp, idx) => {
      const progress = idx / (benchmarkPoints.length - 1 || 1);
      const x = paddingX + progress * (width - paddingX * 2);

      // Usar diretamente o valor simulado do portfólio SXR8 na escala Y
      const val = bp.simulatedValue !== undefined && bp.simulatedValue > 0
        ? bp.simulatedValue
        : firstPortVal * (1 + bp.changePercent / 100);
      const y = getY(val);
      return { x, y };
    });
  }, [isBenchmarkActive, benchmarkPoints, chartPoints.length, firstPortVal, minVal, valRange, height, paddingTop, paddingBottom]);

  const benchmarkSmoothPathD = generateSmoothSvgPath(benchmarkCoordinates);

  // Ponto do benchmark correspondente ao crosshair ativo (percentagem e valor total em EUR com base nas compras simuladas)
  const { activeBenchmarkPct, activeBenchmarkValue, activeBenchmarkDiffEur } = useMemo(() => {
    if (!isBenchmarkActive || benchmarkPoints.length === 0) {
      return { activeBenchmarkPct: null, activeBenchmarkValue: null, activeBenchmarkDiffEur: null };
    }

    let activeBp = benchmarkPoints[benchmarkPoints.length - 1];
    if (activePointIndex !== null) {
      const ratio = activePointIndex / (chartPoints.length - 1 || 1);
      const bIdx = Math.min(
        benchmarkPoints.length - 1,
        Math.max(0, Math.round(ratio * (benchmarkPoints.length - 1)))
      );
      activeBp = benchmarkPoints[bIdx] || activeBp;
    }

    if (!activeBp) {
      return { activeBenchmarkPct: null, activeBenchmarkValue: null, activeBenchmarkDiffEur: null };
    }

    const simulatedVal = activeBp.simulatedValue ?? totalInvested * (1 + (activeBp.changePercent || 0) / 100);
    const diffEur = activeBp.diffEur ?? (simulatedVal - totalInvested);
    const pct = activeBp.changePercent ?? 0;

    return {
      activeBenchmarkPct: pct,
      activeBenchmarkValue: Number(simulatedVal.toFixed(2)),
      activeBenchmarkDiffEur: Number(diffEur.toFixed(2)),
    };
  }, [isBenchmarkActive, benchmarkPoints, activePointIndex, chartPoints.length, totalInvested]);

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
  const isBenchmarkPositive = activeBenchmarkPct !== null && activeBenchmarkPct >= 0;

  return (
    <div id="home-tab-container" className="w-full flex-1 flex flex-col px-5 pt-3 pb-8 bg-white select-none">
      {/* Aviso de falha na automação diária (se decorridos mais de 2 dias úteis sem novos snapshots) */}
      <SyncWarningBanner snapshots={snapshots} />

      {/* 1. Cabeçalho Superior: Valor Total em Destaque & Rentabilidade */}
      <div className="flex flex-col mb-2">
        {/* Linha Principal do Portfólio */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <span className="text-3xl font-black text-slate-900 tracking-tight tabular-nums">
              €{activePoint.value.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span
              className={`text-sm font-medium tabular-nums flex items-center gap-0.5 ${
                isPositiveReturn ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {isPositiveReturn ? '↗' : '↘'}
              {isPositiveReturn ? '+' : ''}
              {activePoint.changePercent.toFixed(2)}%
            </span>
            <span
              className={`text-xs font-normal tabular-nums mt-0.5 ${
                isPositiveReturn ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {isPositiveReturn ? '+' : ''}€{activePoint.changeEur.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Linha Amarela do Benchmark SXR8.DE quando ativo */}
        {isBenchmarkActive && (
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-amber-100/70">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block shadow-sm" />
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">SXR8.DE</span>
              <span className="text-base font-bold text-amber-600 tracking-tight tabular-nums">
                {activeBenchmarkValue !== null
                  ? `€${activeBenchmarkValue.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 tabular-nums">
                {activeBenchmarkPct !== null
                  ? `${isBenchmarkPositive ? '+' : ''}${activeBenchmarkPct.toFixed(2)}%`
                  : '...'}
              </span>
              {activeBenchmarkDiffEur !== null && (
                <span className="text-xs font-normal text-amber-600/90 tabular-nums">
                  ({activeBenchmarkDiffEur >= 0 ? '+' : ''}€{activeBenchmarkDiffEur.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Gráfico Sparkline em Linha Azul Fluida Fina, sem gradiente, sem grelha e sem eixos */}
      <div className="w-full relative my-1">
        {/* Data agregada ao lado esquerdo da linha vertical, a uma altura fixa */}
        {activePointIndex !== null && (
          <div
            className="absolute top-1 pointer-events-none z-10 pr-2 transition-transform duration-75 ease-out"
            style={{
              left: `${(getX(activePointIndex) / width) * 100}%`,
              transform: getX(activePointIndex) < 70 ? 'translateX(6px)' : 'translateX(-100%)',
            }}
          >
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              {activePoint.dateStr}
            </span>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-52 overflow-visible cursor-crosshair touch-none"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onPointerUp={handlePointerLeave}
        >
          {/* Linha do Benchmark SXR8.DE (S&P 500) em AMARELO quando ativo */}
          {isBenchmarkActive && benchmarkSmoothPathD && (
            <path
              d={benchmarkSmoothPathD}
              fill="none"
              stroke="#F59E0B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Linha Principal do Gráfico (AZUL #2563EB - curva suave Bézier fina, limpa, sem preenchimento, sem grelha) */}
          {smoothPathD && (
            <path
              d={smoothPathD}
              fill="none"
              stroke="#2563EB"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Crosshair Interativo: Linha Vertical Tracejada de extremo a extremo do gráfico, sem bolinhas */}
          {activePointIndex !== null && (
            <line
              x1={getX(activePointIndex)}
              y1={0}
              x2={getX(activePointIndex)}
              y2={height}
              stroke="#94A3B8"
              strokeWidth="1.25"
              strokeDasharray="4 4"
            />
          )}
        </svg>
      </div>

      {/* 3. Ação "+ Benchmark" / Comparação SXR8.DE alinhada à direita sob o gráfico */}
      <div className="w-full flex items-center justify-between mt-2 mb-4">
        {/* Legenda de comparação quando ativo */}
        {isBenchmarkActive ? (
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-blue-600">
              <span className="w-2.5 h-0.5 bg-blue-600 rounded-full inline-block" />
              <span>Portfólio ({activePoint.changePercent >= 0 ? '+' : ''}{activePoint.changePercent.toFixed(2)}%)</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium text-amber-600">
              <span className="w-2.5 h-0.5 bg-amber-500 rounded-full inline-block" />
              <span>
                SXR8.DE (
                {isBenchmarkLoading
                  ? 'A carregar...'
                  : activeBenchmarkPct !== null && !isNaN(activeBenchmarkPct)
                  ? `${activeBenchmarkPct >= 0 ? '+' : ''}${activeBenchmarkPct.toFixed(2)}%`
                  : '—'}
                )
              </span>
            </div>
          </div>
        ) : (
          <div />
        )}

        <button
          type="button"
          id="btn-benchmark"
          className={`text-sm font-normal transition-colors flex items-center gap-1 cursor-pointer select-none active:opacity-70 ${
            isBenchmarkActive
              ? 'text-amber-700 font-medium bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200/60'
              : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setIsBenchmarkActive((prev) => !prev)}
        >
          <span className="text-base font-light leading-none">
            {isBenchmarkActive ? '✕' : '+'}
          </span>
          <span>{isBenchmarkActive ? 'SXR8.DE' : 'Benchmark'}</span>
        </button>
      </div>

      {/* 4. Seletor de Período idêntico ao gráfico de ações (pílulas com cantos arredondados, perfeitamente ajustadas à largura) */}
      <div className="w-full flex items-center justify-center mt-1">
        <div className="w-full max-w-sm flex items-center justify-between gap-1 py-1">
          {(['1D', '1S', '1M', '3M', '6M', '1A', 'Tudo'] as TimeRange[]).map((range) => {
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
                className={`flex-1 py-1 text-xs rounded-full font-medium transition-all text-center cursor-pointer select-none ${
                  isActive
                    ? 'bg-sky-100 text-sky-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-600'
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
