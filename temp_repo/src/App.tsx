/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DonutChart } from './components/DonutChart';
import { QuickFilters } from './components/QuickFilters';
import { HoldingsSection } from './components/HoldingsSection';
import { BottomTabBar } from './components/BottomTabBar';
import { SettingsTab } from './components/SettingsTab';
import { HomeTab } from './components/HomeTab';
import { PullToRefresh } from './components/PullToRefresh';
import { ContributionCalculatorModal } from './components/ContributionCalculatorModal';
import { StockChartModal } from './components/StockChartModal';
import { TabType, HoldingDoc, PortfolioPosition } from './types';
import {
  subscribeUserHoldings,
  fetchLiveQuotes,
  computePortfolio,
} from './services/portfolioService';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('allocation');
  const [isCalculatorOpen, setIsCalculatorOpen] = useState<boolean>(false);
  const [selectedPositionForChart, setSelectedPositionForChart] = useState<PortfolioPosition | null>(null);
  const [holdings, setHoldings] = useState<HoldingDoc[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Refresh function that fetches live quotes and computes positions
  const refreshPortfolio = async (currentHoldings: HoldingDoc[]) => {
    if (!currentHoldings || currentHoldings.length === 0) {
      setPositions([]);
      setTotalValue(0);
      setIsLoading(false);
      return;
    }

    try {
      const tickers = currentHoldings.map((h) => h.ticker);
      const liveQuotes = await fetchLiveQuotes(tickers);
      const computed = computePortfolio(currentHoldings, liveQuotes);
      setPositions(computed.positions);
      setTotalValue(computed.totalValue);
    } catch (err) {
      console.error('Error updating live prices:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Subscribe directly to Firestore holdings
  useEffect(() => {
    const unsubscribe = subscribeUserHoldings(
      'main',
      async (userHoldings) => {
        setHoldings(userHoldings);
        await refreshPortfolio(userHoldings);
      },
      (err) => {
        console.error('Firestore subscription error:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Automatic background refresh every 30 seconds across the entire application
  useEffect(() => {
    if (holdings.length === 0) return;

    const intervalId = setInterval(() => {
      refreshPortfolio(holdings);
    }, 30000); // 30 seconds

    return () => clearInterval(intervalId);
  }, [holdings]);

  return (
    <div className="min-h-screen bg-[#FAFAFC] text-slate-900 flex justify-center selection:bg-sky-100">
      {/* Mobile iPhone viewport container */}
      <main className="w-full max-w-md bg-white min-h-screen flex flex-col shadow-sm relative pt-[env(safe-area-inset-top,12px)]">
        {/* Main Content Area with 120Hz smooth transition */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'home' ? (
              <motion.div
                key="home-tab"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                className="flex-1 bg-white min-h-full overflow-y-auto"
              >
                <HomeTab
                  totalValue={totalValue}
                  positions={positions}
                  holdings={holdings}
                  onSyncComplete={() => setActiveTab('allocation')}
                />
              </motion.div>
            ) : activeTab === 'allocation' ? (
              <motion.div
                key="allocation-tab"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                className="flex-1 flex flex-col h-full overflow-hidden"
              >
                <PullToRefresh
                  onRefresh={async () => {
                    await refreshPortfolio(holdings);
                  }}
                  className="flex-1"
                >
                  {/* Donut Chart: live Firestore data or €0,00 with 0 positions */}
                  <DonutChart
                    totalValue={totalValue}
                    currencySymbol="€"
                    positionsCount={positions.length}
                    positions={positions}
                  />

                  {/* Quick Action + (Opens Contribution Rebalance Calculator) */}
                  <QuickFilters onPlusClick={() => setIsCalculatorOpen(true)} />

                  {/* Holdings Section by Weight */}
                  <HoldingsSection
                    positions={positions}
                    onSelectPosition={(pos) => setSelectedPositionForChart(pos)}
                  />
                </PullToRefresh>
              </motion.div>
            ) : (
              <motion.div
                key="settings-tab"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                className="flex-1 bg-white min-h-full overflow-y-auto no-scrollbar"
              >
                <SettingsTab onSyncComplete={() => setActiveTab('allocation')} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* iOS Native Style Bottom Navigation Tab Bar (Allocation & +) */}
        <BottomTabBar
          currentTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Contribution & Rebalance Calculator Modal */}
        <ContributionCalculatorModal
          isOpen={isCalculatorOpen}
          onClose={() => setIsCalculatorOpen(false)}
          positions={positions}
          totalValue={totalValue}
        />

        {/* Interactive Stock & ETF Chart Modal with Purchase Marker */}
        <StockChartModal
          isOpen={selectedPositionForChart !== null}
          position={selectedPositionForChart}
          holding={
            selectedPositionForChart
              ? holdings.find(
                  (h) => h.ticker.toUpperCase() === selectedPositionForChart.ticker.toUpperCase()
                )
              : null
          }
          onClose={() => setSelectedPositionForChart(null)}
        />
      </main>
    </div>
  );
}



