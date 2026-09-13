import React from 'react';
import { Home, PieChart, Settings } from 'lucide-react';
import { TabType } from '../types';

interface BottomTabBarProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  currentTab,
  onTabChange,
}) => {
  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    {
      id: 'home',
      label: 'Home',
      icon: <Home className="w-6 h-6 stroke-[2.2]" />,
    },
    {
      id: 'allocation',
      label: 'Alocação',
      icon: <PieChart className="w-6 h-6 stroke-[2.2]" />,
    },
    {
      id: 'settings',
      label: 'Definições',
      icon: <Settings className="w-6 h-6 stroke-[2.5]" />,
    },
  ];

  return (
    <nav
      id="bottom-tab-bar"
      aria-label="Barra de navegação principal"
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-100 pb-[env(safe-area-inset-bottom,16px)] pt-2 px-8"
    >
      <div className="max-w-md mx-auto flex items-center justify-around gap-8">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-btn-${tab.id}`}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`ios-touch-active flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] cursor-pointer transition-colors duration-150 ${
                isActive
                  ? 'text-sky-500 font-bold'
                  : 'text-slate-400 font-medium active:text-slate-600'
              }`}
            >
              <div className="relative flex items-center justify-center">
                {tab.icon}
              </div>
              <span className="text-[11px] tracking-tight mt-1 whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

