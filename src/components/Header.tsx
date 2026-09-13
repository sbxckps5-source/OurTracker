import React from 'react';
import { Upload } from 'lucide-react';

interface HeaderProps {
  portfolioName?: string;
  dateLabel?: string;
  onImportClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  portfolioName = 'PORTSEIDO',
  dateLabel = 'Sep 2026',
  onImportClick,
}) => {
  return (
    <header
      id="app-header"
      className="w-full pt-4 pb-3 px-5 flex items-center justify-between border-b border-slate-100 bg-white"
    >
      {/* Portfolio Title & Date */}
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-xl tracking-tight text-[#1E1B4B]">
            {portfolioName}
          </span>
        </div>
        <span className="text-xs text-slate-400 font-medium tracking-wide">
          {dateLabel}
        </span>
      </div>

      {/* Top Action: Import button only (no plus button, no logic yet) */}
      <div className="flex items-center gap-2">
        <button
          id="btn-import-header"
          type="button"
          onClick={onImportClick}
          aria-label="Importar transações ou portfólio"
          className="ios-touch-active inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 bg-white shadow-xs text-sm font-semibold text-slate-700 active:bg-slate-50 cursor-pointer min-h-[44px]"
        >
          <Upload className="w-4 h-4 text-purple-600 stroke-[2.2]" />
          <span>Import</span>
        </button>
      </div>
    </header>
  );
};
