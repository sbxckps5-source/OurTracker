import React from 'react';
import { Plus } from 'lucide-react';

interface QuickFiltersProps {
  onPlusClick?: () => void;
}

export const QuickFilters: React.FC<QuickFiltersProps> = ({ onPlusClick }) => {
  return (
    <div
      id="quick-actions-row"
      className="w-full px-5 py-1 flex items-center justify-end"
    >
      <button
        type="button"
        id="btn-quick-add"
        onClick={onPlusClick}
        aria-label="Adicionar"
        className="ios-touch-active w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 flex items-center justify-center transition-all cursor-pointer border border-slate-200/60 shadow-2xs"
      >
        <Plus className="w-4 h-4 stroke-[2.5]" />
      </button>
    </div>
  );
};

