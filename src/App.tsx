/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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

  // Reset signals for returning to initial view of each tab when re-tapping
  const [settingsResetSignal, setSettingsResetSignal] = useState<number>(0);
  const [homeResetSignal, setHomeResetSignal] = useState<number>(0);

  const homeContainerRef = useRef<HTMLDivElement>(null);
  const allocationContainerRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);

  const handleTabChange = (newTab: TabType) => {
    if (newTab === activeTab) {
      // Re-clicou na aba ativa: repor para o ecrã inicial dessa aba
      if (newTab === 'settings') {
        setSettingsResetSignal((prev) => prev + 1);
        if (settingsContainerRef.current) {
          settingsContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (newTab === 'allocation') {
        setIsCalculatorOpen(false);
        setSelectedPositionForChart(null);
        if (allocationContainerRef.current) {
          allocationContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else if (newTab === 'home') {
        setHomeResetSignal((prev) => prev + 1);
        if (homeContainerRef.current) {
          homeContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    } else {
      setActiveTab(newTab);
    }
  };

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
      {/* Loading Screen iOS Native com efeito de gradiente suave no nome OurTracker */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="app-loading-screen"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
            className="fixed inset-0 z-[100] bg-white flex items-center justify-center select-none px-6"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex flex-col items-center justify-center text-center leading-none"
            >
              <span className="text-4xl sm:text-5xl font-extrabold tracking-tight loading-gradient-text block">
                Our
              </span>
              <span className="text-4xl sm:text-5xl font-extrabold tracking-tight loading-gradient-text block mt-1">
                Tracker
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile iPhone viewport container */}
      <main className="w-full max-w-md bg-white min-h-screen flex flex-col shadow-sm relative pt-[env(safe-area-inset-top,12px)]">
        {/* Main Content Area with 120Hz smooth transition */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'home' ? (
              <motion.div
                key="home-tab"
                ref={homeContainerRef}
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
                  resetSignal={homeResetSignal}
                />
              </motion.div>
            ) : activeTab === 'allocation' ? (
              <motion.div
                key="allocation-tab"
                ref={allocationContainerRef}
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
                ref={settingsContainerRef}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
                className="flex-1 bg-white min-h-full overflow-y-auto no-scrollbar"
              >
                <SettingsTab
                  onSyncComplete={() => setActiveTab('allocation')}
                  resetSignal={settingsResetSignal}
                  positions={positions}
                  holdings={holdings}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* iOS Native Style Bottom Navigation Tab Bar (Allocation & +) */}
        <BottomTabBar
          currentTab={activeTab}
          onTabChange={handleTabChange}
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



