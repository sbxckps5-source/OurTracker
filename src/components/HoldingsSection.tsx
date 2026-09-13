import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, AlertCircle } from 'lucide-react';
import { PortfolioPosition } from '../types';
import { getShortDescription } from '../utils/tickerHelper';

interface HoldingsSectionProps {
  positions?: PortfolioPosition[];
  onSelectPosition?: (position: PortfolioPosition) => void;
}

export const HoldingsSection: React.FC<HoldingsSectionProps> = ({
  positions = [],
  onSelectPosition,
}) => {
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const count = positions.length;

  return (
    <section
      id="holdings-section"
      className="w-full px-5 pt-1 pb-16 flex flex-col"
    >
      {/* Clean Separation Line */}
      <div className="w-full border-b border-slate-100 my-1" />

      {/* Content: 0 positions empty layout */}
      {count === 0 ? (
        <div
          id="holdings-empty-state"
          className="w-full mt-6 py-12 px-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center"
        >
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <Layers className="w-5 h-5 stroke-[1.8]" />
          </div>
          <p className="text-sm font-semibold text-slate-700">
            Nenhuma posição registada
          </p>
          <p className="text-xs text-slate-400 max-w-[240px] mt-1 leading-relaxed">
            O portfólio está a €0,00 na Firestore. Toca no botão + para adicionar ativos em tempo real via Yahoo Finance.
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100 mt-1">
          {positions.map((item) => {
            const shortName = getShortDescription(item.ticker, item.name);
            const isExpanded = expandedTicker === item.ticker;

            // Calculations for Invested vs Market Value & Gain/Loss
            const marketValue = item.value;
            const totalInvested = item.totalInvested !== undefined
              ? item.totalInvested
              : item.totalReturnPercent !== undefined && item.totalReturnPercent !== -100
                ? Number((item.value / (1 + item.totalReturnPercent / 100)).toFixed(2))
                : item.value;
            const diffEur = Number((marketValue - totalInvested).toFixed(2));
            const diffPercent = totalInvested > 0 ? (diffEur / totalInvested) * 100 : 0;
            const isGain = diffEur >= 0;

            return (
              <div key={item.id} className="flex flex-col">
                <div
                  onClick={() => onSelectPosition && onSelectPosition(item)}
                  className={`ios-touch-active py-3.5 flex items-center justify-between cursor-pointer min-h-[56px] transition-colors ${
                    item.isError
                      ? 'bg-rose-50/50 -mx-2 px-2 rounded-xl border border-rose-200 my-1'
                      : ''
                  }`}
                >
                  {/* Left Column: Color dot, Allocation %, Ticker & Short Abbreviated Description */}
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0 shadow-2xs"
                      style={{ backgroundColor: item.isError ? '#EF4444' : item.color }}
                    />

                    {/* Allocation % between dot and name */}
                    <span className="text-xs font-bold text-slate-500 w-11 tabular-nums text-left flex-shrink-0">
                      {item.allocationPercent}%
                    </span>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-slate-900 tracking-tight">
                          {item.ticker}
                        </span>
                        {item.isError && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded">
                            <AlertCircle className="w-2.5 h-2.5" />
                            Erro
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 font-medium truncate max-w-[130px]">
                        {shortName}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Return % and Value in EUR - Clickable to toggle Invested vs Market comparison */}
                  <div className="flex flex-col items-end">
                    {item.isError ? (
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-xs text-rose-600 flex items-center gap-1">
                          Cotação indisponível
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {item.shares} {item.shares === 1 ? 'ação' : 'ações'}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Ver comparação de investimento para ${item.ticker}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTicker((prev) => (prev === item.ticker ? null : item.ticker));
                        }}
                        className="flex items-center gap-3 py-1 px-2 -mr-2 rounded-lg hover:bg-slate-100/70 active:bg-slate-200/60 active:scale-95 transition-all cursor-pointer"
                      >
                        {(item.totalReturnPercent !== undefined || item.monthReturnPercent !== undefined) ? (
                          (() => {
                            const returnVal = item.totalReturnPercent !== undefined ? item.totalReturnPercent : item.monthReturnPercent!;
                            return (
                              <span
                                className={`text-xs font-bold tabular-nums ${
                                  returnVal >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                }`}
                              >
                                {returnVal >= 0 ? '+' : ''}
                                {returnVal.toFixed(2)}%
                              </span>
                            );
                          })()
                        ) : null}
                        <span className="font-bold text-sm text-slate-900 tracking-tight">
                          €{item.value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Comparison: Invested vs Market Value vs Gain/Loss */}
                <AnimatePresence>
                  {isExpanded && !item.isError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mb-3 mx-1 bg-slate-50/90 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-2 shadow-2xs">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Valor Investido:</span>
                          <span className="font-bold text-slate-800 tabular-nums">
                            €{totalInvested.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">Valor de Mercado:</span>
                          <span className="font-bold text-slate-800 tabular-nums">
                            €{marketValue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>

                        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
                          <span className="text-slate-600 font-semibold">Diferença (P&amp;L):</span>
                          <span
                            className={`font-black tabular-nums flex items-center gap-1 ${
                              isGain ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            <span>{isGain ? '↗' : '↘'}</span>
                            <span>
                              {isGain ? '+' : '-'}€{Math.abs(diffEur).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-[11px] font-bold opacity-90">
                              ({isGain ? '+' : ''}{diffPercent.toFixed(2)}%)
                            </span>
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
