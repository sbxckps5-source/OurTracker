import React from 'react';
import { PortfolioPosition, HoldingDoc } from '../types';

interface HomeTabProps {
  totalValue?: number;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
  onSyncComplete?: () => void;
  resetSignal?: number;
}

export const HomeTab: React.FC<HomeTabProps> = () => {
  return (
    <div
      id="home-tab-container"
      className="w-full flex-1 flex flex-col items-center justify-center p-6 min-h-[60vh]"
    >
      {/* Página inicial limpa / vazia */}
    </div>
  );
};
