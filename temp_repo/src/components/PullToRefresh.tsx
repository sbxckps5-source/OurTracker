import React, { useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = '',
}) => {
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isPullingRef = useRef(false);

  const THRESHOLD = 52;

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (isRefreshing) return;

    // Do not initiate pull to refresh when interacting with the chart
    const target = e.target as HTMLElement | null;
    if (target && target.closest('[data-no-pull="true"], #portfolio-donut-section')) {
      isPullingRef.current = false;
      return;
    }

    const container = containerRef.current;
    if (!container || container.scrollTop > 0) return;

    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startYRef.current = clientY;
    startXRef.current = clientX;
    isPullingRef.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isPullingRef.current || isRefreshing) return;
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      if (pullY > 0) setPullY(0);
      isPullingRef.current = false;
      return;
    }

    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diffY = clientY - startYRef.current;
    const diffX = clientX - startXRef.current;

    // Only engage if moving predominantly downward with initial deadzone of 8px
    if (diffY > 8 && diffY > Math.abs(diffX) * 0.8) {
      const pull = Math.min(75, (diffY - 8) * 0.42);
      setPullY(pull);
    } else if (diffY <= 0) {
      setPullY(0);
    }
  };

  const handleTouchEnd = async () => {
    if (!isPullingRef.current) return;
    isPullingRef.current = false;

    if (pullY >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(THRESHOLD); // Hold position while refreshing
      try {
        await onRefresh();
      } catch (err) {
        console.error('Pull to refresh failed:', err);
      } finally {
        setTimeout(() => {
          setIsRefreshing(false);
          setPullY(0);
        }, 350);
      }
    } else {
      setPullY(0);
    }
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseMove={handleTouchMove}
      onMouseUp={handleTouchEnd}
      className={`relative overflow-y-auto overflow-x-hidden no-scrollbar ${className}`}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* Pull Indicator */}
      <div
        className="w-full flex items-center justify-center pointer-events-none transition-all duration-200 overflow-hidden"
        style={{
          height: isRefreshing ? `${THRESHOLD}px` : `${pullY}px`,
          opacity: pullY > 10 || isRefreshing ? Math.min(1, pullY / 25) : 0,
        }}
      >
        <div className="flex items-center gap-2 py-1.5 px-3.5 bg-white/95 backdrop-blur-md rounded-full shadow-xs border border-slate-200/80 text-slate-600 my-1">
          <RefreshCw
            className={`w-3.5 h-3.5 text-sky-500 ${
              isRefreshing
                ? 'animate-spin'
                : ''
            }`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${pullY * 4.5}deg)`,
            }}
          />
          <span className="text-[11px] font-semibold text-slate-600">
            {isRefreshing
              ? 'A atualizar cotações...'
              : pullY >= THRESHOLD
              ? 'Solta para atualizar'
              : 'Puxa para atualizar'}
          </span>
        </div>
      </div>

      {/* Main Children */}
      {children}
    </div>
  );
};

