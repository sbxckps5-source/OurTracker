import React, { useState, useEffect } from 'react';
import { Edit2, Layers, Database, X, DollarSign, Briefcase } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DepositModal } from './DepositModal';
import { AddAssetForm } from './AddAssetForm';
import { EditPortfolioView } from './EditPortfolioView';
import { BackupView } from './BackupView';

import { HoldingDoc, PortfolioPosition } from '../types';

interface SettingsTabProps {
  onSyncComplete?: () => void;
  resetSignal?: number;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
}

type ViewState = 'main' | 'add_type' | 'add_asset' | 'edit_portfolio' | 'backup';

export const SettingsTab: React.FC<SettingsTabProps> = ({
  onSyncComplete,
  resetSignal,
  positions = [],
  holdings = [],
}) => {
  const [currentView, setCurrentView] = useState<ViewState>('main');
  const [isDepositModalOpen, setIsDepositModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (resetSignal) {
      setCurrentView('main');
      setIsDepositModalOpen(false);
    }
  }, [resetSignal]);

  return (
    <div className="w-full h-full relative overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {/* Vista Principal das Definições */}
        {currentView === 'main' && (
          <motion.div
            key="settings-main"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className="w-full h-full flex flex-col p-4 pb-24"
          >
            <h1 className="text-xl font-bold text-slate-900 py-3">Definições</h1>

            <div className="flex-1 flex flex-col justify-center items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentView('add_type')}
                className="w-full max-w-xs min-h-[56px] bg-white border border-slate-200 rounded-2xl flex items-center gap-4 px-5 active:scale-98 transition-transform shadow-sm cursor-pointer"
              >
                <Edit2 className="w-5 h-5 text-slate-600 stroke-[2.2]" />
                <span className="font-bold text-slate-900 text-sm">Adicionar manualmente</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentView('edit_portfolio')}
                className="w-full max-w-xs min-h-[56px] bg-white border border-slate-200 rounded-2xl flex items-center gap-4 px-5 active:scale-98 transition-transform shadow-sm cursor-pointer"
              >
                <Layers className="w-5 h-5 text-slate-600 stroke-[2.2]" />
                <span className="font-bold text-slate-900 text-sm">Editar portfólio</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentView('backup')}
                className="w-full max-w-xs min-h-[56px] bg-white border border-slate-200 rounded-2xl flex items-center gap-4 px-5 active:scale-98 transition-transform shadow-sm cursor-pointer"
              >
                <Database className="w-5 h-5 text-slate-600 stroke-[2.2]" />
                <span className="font-bold text-slate-900 text-sm">Backup</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Página: Tipo de Adição (Depósito / Ativo) */}
        {currentView === 'add_type' && (
          <motion.div
            key="settings-add-type"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className="w-full h-full flex flex-col p-4 pb-24 relative"
          >
            {/* Botão X discreto no canto superior direito, sem bolinha e sem cabeçalho */}
            <div className="w-full flex justify-end pt-2 pb-1">
              <button
                type="button"
                onClick={() => setCurrentView('main')}
                className="p-2 text-slate-400 hover:text-slate-600 active:text-slate-900 active:scale-95 transition-all cursor-pointer"
                aria-label="Voltar"
              >
                <X className="w-6 h-6 stroke-[2]" />
              </button>
            </div>

            {/* Menu de Opções perfeitamente centrado vertical e horizontalmente */}
            <div className="flex-1 flex flex-col justify-center items-center gap-3">
              {/* Opção 1: Depósito */}
              <button
                type="button"
                onClick={() => setIsDepositModalOpen(true)}
                className="w-full max-w-xs min-h-[56px] bg-white border border-slate-200 rounded-2xl flex items-center gap-4 px-5 active:scale-98 transition-transform shadow-sm cursor-pointer"
              >
                <DollarSign className="w-5 h-5 text-slate-600 stroke-[2.2]" />
                <span className="font-bold text-slate-900 text-sm">Depósito</span>
              </button>

              {/* Opção 2: Ativo */}
              <button
                type="button"
                onClick={() => setCurrentView('add_asset')}
                className="w-full max-w-xs min-h-[56px] bg-white border border-slate-200 rounded-2xl flex items-center gap-4 px-5 active:scale-98 transition-transform shadow-sm cursor-pointer"
              >
                <Briefcase className="w-5 h-5 text-slate-600 stroke-[2.2]" />
                <span className="font-bold text-slate-900 text-sm">Ativo</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Formulário: Adicionar Ativo */}
        {currentView === 'add_asset' && (
          <AddAssetForm
            key="settings-add-asset"
            onBack={() => setCurrentView('add_type')}
            onSuccess={() => {
              if (onSyncComplete) onSyncComplete();
              setCurrentView('main');
            }}
          />
        )}

        {/* Vista: Editar Portfólio */}
        {currentView === 'edit_portfolio' && (
          <EditPortfolioView
            key="settings-edit-portfolio"
            onBack={() => setCurrentView('main')}
            positions={positions}
            holdings={holdings}
          />
        )}

        {/* Vista: Backup */}
        {currentView === 'backup' && (
          <BackupView
            key="settings-backup"
            onBack={() => setCurrentView('main')}
            onSyncComplete={onSyncComplete}
          />
        )}
      </AnimatePresence>

      {/* Balão Modal de Depósito centrado com desfoque de fundo */}
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        onSuccess={() => {
          if (onSyncComplete) onSyncComplete();
        }}
      />
    </div>
  );
};
