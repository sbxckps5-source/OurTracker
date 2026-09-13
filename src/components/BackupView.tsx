import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  fetchCloudBackups,
  createCloudBackup,
  restoreCloudBackup,
  deleteCloudBackup,
  BackupDoc,
} from '../services/portfolioService';
import { HoldingDoc } from '../types';

interface BackupViewProps {
  onBack: () => void;
  onSyncComplete?: () => void;
}

export const BackupView: React.FC<BackupViewProps> = ({
  onBack,
  onSyncComplete,
}) => {
  const [backups, setBackups] = useState<BackupDoc[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [expandedBackupIds, setExpandedBackupIds] = useState<Record<string, boolean>>({});

  // Modal de confirmação centrado com fundo desfocado
  const [confirmModal, setConfirmModal] = useState<{
    type: 'restore' | 'delete';
    backup: BackupDoc;
  } | null>(null);

  // Carregar lista de backups
  const loadBackups = async () => {
    try {
      setIsLoading(true);
      const list = await fetchCloudBackups('main');
      setBackups(list);
    } catch (err) {
      console.error('Erro ao carregar backups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  // Alternar minimização de cada backup (pré-definidos minimizados)
  const toggleExpand = (id: string) => {
    setExpandedBackupIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Criar novo backup
  const handleCreateBackup = async () => {
    try {
      setIsProcessing(true);
      await createCloudBackup('main');
      await loadBackups();
    } catch (err) {
      console.error('Erro ao criar backup:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Executar confirmação (Restaurar ou Eliminar)
  const handleConfirmAction = async () => {
    if (!confirmModal) return;
    const { type, backup } = confirmModal;

    try {
      setIsProcessing(true);
      if (type === 'restore') {
        await restoreCloudBackup(backup, 'main');
        setConfirmModal(null);
        if (onSyncComplete) onSyncComplete();
        onBack();
      } else if (type === 'delete') {
        await deleteCloudBackup(backup.id, 'main');
        setConfirmModal(null);
        await loadBackups();
      }
    } catch (err) {
      console.error(`Erro ao ${type} backup:`, err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Cálculos de resumo de um backup
  const getBackupSummary = (backup: BackupDoc) => {
    const meta = backup.meta || {};
    const depositsList = Array.isArray(meta.deposits) ? meta.deposits : [];
    const totalDeposits =
      meta.totalDeposited !== undefined
        ? Number(meta.totalDeposited)
        : depositsList.reduce((sum: number, d: any) => sum + (Number(d.amount) || 0), 0);

    const holdingsList: HoldingDoc[] = backup.holdings || [];

    const parsedHoldings = holdingsList.map((h) => {
      const purchases = Array.isArray(h.purchases) ? h.purchases : [];
      const entriesCount = purchases.length > 0 ? purchases.length : 1;
      const totalInvested = purchases.length > 0
        ? purchases.reduce(
            (acc, p) => acc + (Number(p.shares) || 0) * (Number(p.priceEur ?? p.price) || 0),
            0
          )
        : Number(h.shares || 0) * 0; // se não houver compras explícitas

      return {
        ticker: h.ticker,
        color: h.color,
        shares: Number(h.shares || 0),
        entriesCount,
        totalInvested,
      };
    });

    return {
      totalDeposits,
      depositsCount: depositsList.length,
      holdings: parsedHoldings,
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
      className="w-full h-full flex flex-col p-4 pb-28 relative overflow-y-auto"
    >
      {/* Botão X discreto no topo direito sem cabeçalho */}
      <div className="w-full flex justify-end pt-2 pb-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isProcessing}
          className="p-2 text-slate-400 hover:text-slate-600 active:text-slate-900 active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <X className="w-6 h-6 stroke-[2]" />
        </button>
      </div>

      {/* Conteúdo perfeitamente centrado */}
      <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-5 my-auto py-2">
        {/* Balão "Criar backup" com fundo na cor azul das abas (sky-500) */}
        <button
          type="button"
          onClick={handleCreateBackup}
          disabled={isProcessing}
          className="w-full h-14 bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-bold text-base rounded-2xl flex items-center justify-center gap-2 active:scale-98 transition-all shadow-sm cursor-pointer select-none"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>A processar...</span>
            </>
          ) : (
            <span>Criar backup</span>
          )}
        </button>

        {/* Tabela / Lista de Backups */}
        <div className="w-full flex flex-col gap-3">
          {isLoading ? (
            <div className="py-8 flex items-center justify-center text-slate-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>A carregar backups...</span>
            </div>
          ) : backups.length === 0 ? (
            <div className="py-8 px-4 text-center text-xs text-slate-400 font-medium bg-white border border-slate-200 rounded-2xl">
              Nenhum backup encontrado
            </div>
          ) : (
            backups.map((backup) => {
              const isExpanded = Boolean(expandedBackupIds[backup.id]);
              const summary = getBackupSummary(backup);

              return (
                <div
                  key={backup.id}
                  className="w-full bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden transition-all"
                >
                  {/* Cabeçalho do Backup: Data e Hora, Botão Restaurar e Chevron */}
                  <div className="w-full p-4 flex items-center justify-between gap-2 select-none">
                    {/* Data e Hora */}
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-sm text-slate-900 tracking-tight">
                        {backup.formattedDate}
                      </span>
                    </div>

                    {/* Ações: Restaurar e Chevron */}
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmModal({ type: 'restore', backup });
                        }}
                        disabled={isProcessing}
                        className="px-3 py-1 bg-sky-50 text-sky-600 hover:bg-sky-100 active:bg-sky-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Restaurar
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleExpand(backup.id)}
                        className="p-1 text-slate-400 hover:text-slate-600 active:scale-95 transition-transform cursor-pointer"
                        aria-label={isExpanded ? 'Minimizar' : 'Maximizar'}
                      >
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 stroke-[2] transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Conteúdo ao maximizar: Total de depósitos + Ações + Botão Eliminar a vermelho */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
                        className="overflow-hidden border-t border-slate-100 bg-slate-50/50 p-4 flex flex-col gap-3.5"
                      >
                        {/* Depósitos: de maneira muito simples com NR de entradas discreto */}
                        <div className="flex items-center justify-between py-1 border-b border-slate-100">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xs font-semibold text-slate-700">Depósitos:</span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              {summary.depositsCount} {summary.depositsCount === 1 ? 'entrada' : 'entradas'}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-slate-900">
                            €
                            {summary.totalDeposits.toLocaleString('pt-PT', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>

                        {/* Ações uma a uma com o total investido e o NR de entradas */}
                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Ativos
                          </span>
                          {summary.holdings.length === 0 ? (
                            <span className="text-xs text-slate-400 italic">Sem ativos</span>
                          ) : (
                            summary.holdings.map((h) => (
                              <div
                                key={h.ticker}
                                className="flex items-center justify-between text-xs py-0.5"
                              >
                                <div className="flex items-baseline gap-1.5 min-w-0">
                                  <span
                                    className="font-bold"
                                    style={{ color: h.color || '#0284c7' }}
                                  >
                                    {h.ticker}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {h.entriesCount} {h.entriesCount === 1 ? 'entrada' : 'entradas'}
                                  </span>
                                </div>
                                <span className="font-medium text-slate-700">
                                  €
                                  {h.totalInvested > 0
                                    ? h.totalInvested.toLocaleString('pt-PT', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })
                                    : (h.shares || 0) + ' un'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Botão Eliminar a vermelho */}
                        <div className="pt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setConfirmModal({ type: 'delete', backup })}
                            disabled={isProcessing}
                            className="px-3.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 active:bg-rose-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                          >
                            Eliminar
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal Centrado com Fundo Desfocado e Bloqueado (Restaurar / Eliminar) */}
      <AnimatePresence>
        {confirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop com desfoque e bloqueio de interação */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => {
                if (!isProcessing) setConfirmModal(null);
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            />

            {/* Balão centrado */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
              className="relative z-10 w-full max-w-xs bg-white rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center gap-5 border border-slate-100"
            >
              <p className="text-base font-bold text-slate-900 leading-snug">
                {confirmModal.type === 'restore'
                  ? 'Tem a certeza que quer restaurar este backup?'
                  : 'Tem a certeza que quer eliminar este backup?'}
              </p>

              {/* Botões: Sim verde, Não vermelho */}
              <div className="w-full flex items-center gap-3">
                {/* Sim (Verde) */}
                <button
                  type="button"
                  onClick={handleConfirmAction}
                  disabled={isProcessing}
                  className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-2xl active:scale-95 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sim'}
                </button>

                {/* Não (Vermelho) */}
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  disabled={isProcessing}
                  className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-sm rounded-2xl active:scale-95 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                >
                  Não
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
