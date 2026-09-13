import React, { useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PortfolioPosition } from '../types';

interface DonutChartProps {
  totalValue?: number;
  currencySymbol?: string;
  positionsCount?: number;
  positions?: PortfolioPosition[];
}

export const DonutChart: React.FC<DonutChartProps> = ({
  totalValue = 0,
  currencySymbol = '€',
  positionsCount = 0,
  positions = [],
}) => {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMouseDownRef = useRef<boolean>(false);

  const radius = 82;
  const circumference = 2 * Math.PI * radius;

  // Filter positions with non-zero allocation and prepare angle boundaries
  const { slices, totalAllocation } = useMemo(() => {
    const validPositions = positions.filter((p) => (p.allocationPercent || 0) > 0);
    const sumAlloc = validPositions.reduce((acc, p) => acc + p.allocationPercent, 0) || 100;

    let accumulatedPercent = 0;
    const computedSlices = validPositions.map((pos, idx) => {
      // Normalize percent relative to total valid allocation so entire 360° is filled
      const normalizedPercent = (pos.allocationPercent / sumAlloc) * 100;
      const startPercent = accumulatedPercent;
      const endPercent = idx === validPositions.length - 1 ? 100.001 : accumulatedPercent + normalizedPercent;

      const strokeDash = (normalizedPercent / 100) * circumference;
      const strokeOffset = -(accumulatedPercent / 100) * circumference;
      accumulatedPercent += normalizedPercent;

      return {
        ...pos,
        startPercent,
        endPercent,
        strokeDash: `${strokeDash} ${circumference}`,
        strokeOffset,
      };
    });

    return { slices: computedSlices, totalAllocation: sumAlloc };
  }, [positions, circumference]);

  const selectedPosition = positions.find((p) => p.ticker === selectedTicker);

  // Precision touch coordinate to slice angle detector (optimized for iPhone finger contact)
  const resolveSliceFromPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      if (!containerRef.current || slices.length === 0) return null;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      // Dead-zone checks: allow generous touch ring around chart (from inner hole to outer rim)
      const chartOuterRadius = rect.width / 2;
      if (dist < chartOuterRadius * 0.22 || dist > chartOuterRadius * 1.35) {
        return null;
      }

      // Calculate screen angle in degrees [0, 360)
      let screenAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (screenAngleDeg < 0) screenAngleDeg += 360;

      // The largest slice starts at 180° (9 o'clock / Left) and goes clockwise towards Right
      const clockwiseDegFromLeft = (screenAngleDeg - 180 + 360) % 360;
      const touchPercentage = (clockwiseDegFromLeft / 360) * 100;

      // Find slice matching touchPercentage
      const matched = slices.find(
        (s) => touchPercentage >= s.startPercent && touchPercentage < s.endPercent
      );

      if (matched) return matched.ticker;
      if (touchPercentage >= 99 && slices.length > 0) return slices[slices.length - 1].ticker;
      if (slices.length > 0) return slices[0].ticker;
      return null;
    },
    [slices]
  );

  // Touch Handlers for iPhone: Only shows percentage while finger is touching the slice
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches.length === 0) return;
    setIsInteracting(true);
    const ticker = resolveSliceFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    if (ticker) {
      setSelectedTicker(ticker);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches.length === 0) return;
    const ticker = resolveSliceFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    if (ticker) {
      setSelectedTicker(ticker);
    }
  };

  const handleTouchEnd = (e?: React.TouchEvent<HTMLDivElement>) => {
    if (e) e.stopPropagation();
    setIsInteracting(false);
    setSelectedTicker(null);
  };

  // Mouse handlers for desktop browser support
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    isMouseDownRef.current = true;
    setIsInteracting(true);
    const ticker = resolveSliceFromPoint(e.clientX, e.clientY);
    if (ticker) {
      setSelectedTicker(ticker);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isMouseDownRef.current) return;
    const ticker = resolveSliceFromPoint(e.clientX, e.clientY);
    if (ticker) {
      setSelectedTicker(ticker);
    }
  };

  const handleMouseUp = (e?: React.MouseEvent<HTMLDivElement>) => {
    if (e) e.stopPropagation();
    isMouseDownRef.current = false;
    setIsInteracting(false);
    setSelectedTicker(null);
  };

  const handleMouseLeave = (e?: React.MouseEvent<HTMLDivElement>) => {
    if (e) e.stopPropagation();
    isMouseDownRef.current = false;
    setIsInteracting(false);
    setSelectedTicker(null);
  };

  const hasPositions = slices.length > 0;
  const activeSlice = slices.find((s) => s.ticker === selectedTicker);

  return (
    <div
      id="portfolio-donut-section"
      data-no-pull="true"
      className="relative w-full flex flex-col items-center justify-center pt-5 pb-3 px-4 select-none touch-none"
    >
      {/* Interactive Donut Wrapper */}
      <div
        ref={containerRef}
        data-no-pull="true"
        className="relative w-[300px] h-[300px] flex items-center justify-center cursor-pointer touch-none"
        style={{ touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* SVG Donut Chart rotated 180° so the largest slice starts at Left (9 o'clock) and sweeps clockwise across Top to Right */}
        <svg
          className="w-full h-full"
          viewBox="0 0 240 240"
        >
          {/* Group rotated 180 degrees around center (120, 120): Start is at Left, direction is Left to Right */}
          <g transform="rotate(180 120 120)">
            {/* Background Track Ring */}
            <circle
              cx="120"
              cy="120"
              r={radius}
              fill="transparent"
              stroke="#F1F5F9"
              strokeWidth="28"
            />

            {!hasPositions ? (
              /* Empty state dashed animated guide */
              <motion.circle
                cx="120"
                cy="120"
                r={radius}
                fill="transparent"
                stroke="#CBD5E1"
                strokeWidth="28"
                strokeDasharray="4 6"
                initial={{ opacity: 0, rotate: 0 }}
                animate={{ opacity: 1, rotate: 360 }}
                transition={{
                  duration: 30,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                style={{ transformOrigin: '120px 120px' }}
              />
            ) : (
              <>
                {/* Base Slices with clear border separation */}
                {slices.map((slice) => {
                  const isSelected = selectedTicker === slice.ticker;
                  return (
                    <circle
                      key={slice.id}
                      cx="120"
                      cy="120"
                      r={radius}
                      fill="transparent"
                      stroke={slice.color}
                      strokeWidth={isSelected ? 36 : 28}
                      strokeDasharray={slice.strokeDash}
                      strokeDashoffset={slice.strokeOffset}
                      className="transition-all duration-150"
                      style={{
                        opacity: isInteracting && !isSelected ? 0.45 : 1,
                      }}
                    />
                  );
                })}

                {/* Elevated Active Slice Rendered on Top for High Precision Feedback on iPhone */}
                {activeSlice && (
                  <circle
                    cx="120"
                    cy="120"
                    r={radius}
                    fill="transparent"
                    stroke={activeSlice.color}
                    strokeWidth="38"
                    strokeDasharray={activeSlice.strokeDash}
                    strokeDashoffset={activeSlice.strokeOffset}
                    className="pointer-events-none transition-all duration-150"
                    style={{
                      filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.22))',
                    }}
                  />
                )}
              </>
            )}
          </g>
        </svg>

        {/* Center Donut Info: Shows percentage ONLY when finger is pressed on a slice */}
        <div
          id="donut-center-info"
          className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6 select-none"
        >
          <AnimatePresence mode="wait">
            {selectedPosition ? (
              <motion.div
                key={`selected-${selectedPosition.ticker}`}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex flex-col items-center justify-center"
              >
                {/* Ticker & Color Indicator */}
                <div className="flex items-center gap-1.5 justify-center max-w-[190px] mb-0.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: selectedPosition.color }}
                  />
                  <span className="text-xs font-black tracking-wider text-slate-800 uppercase truncate">
                    {selectedPosition.ticker}
                  </span>
                </div>

                {/* Primary Metric: Big Percentage displayed only while finger touches slice */}
                <span className="text-3xl font-black tracking-tight text-slate-900 leading-none my-1">
                  {selectedPosition.isError
                    ? 'Erro'
                    : `${selectedPosition.allocationPercent}%`}
                </span>

                {/* Secondary Metric: Monetary Value */}
                <span className="text-xs font-semibold text-slate-500 truncate max-w-[190px]">
                  {selectedPosition.isError
                    ? 'Cotação Indisponível'
                    : `${currencySymbol}${selectedPosition.value.toLocaleString('de-DE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="total-portfolio"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex flex-col items-center justify-center"
              >
                <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  TOTAL PORTFOLIO
                </span>

                <span className="text-2xl font-black tracking-tight text-slate-900 mt-0.5">
                  {currencySymbol}
                  {totalValue.toLocaleString('de-DE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>

                <span className="text-xs font-medium text-slate-400 mt-0.5">
                  {positionsCount} {positionsCount === 1 ? 'posição' : 'posições'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* SVG Donut interactive element */}
    </div>
  );
};

