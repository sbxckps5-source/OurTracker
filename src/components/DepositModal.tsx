import React, { useState } from 'react';
import { X, Check, Loader2, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchPortfolioMeta, savePortfolioMeta } from '../services/portfolioService';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    const numAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Por favor, introduz um montante válido maior que 0.');
      return;
    }

    if (!date) {
      setError('Por favor, seleciona a data do depósito.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      // Carregar metadados atuais do Firestore
      const currentMeta = await fetchPortfolioMeta('main');
      const existingDeposits = currentMeta?.deposits || [];
      const currentTotal = currentMeta?.totalDeposited || 0;

      // Formatar data em padrão legível (DD/MM/AAAA)
      const [year, month, day] = date.split('-');
      const formattedDate = `${day}/${month}/${year}`;

      const newDepositEntry = {
        date: formattedDate,
        amount: Number(numAmount.toFixed(2)),
      };

      const updatedDeposits = [newDepositEntry, ...existingDeposits];
      const updatedTotal = Number((currentTotal + numAmount).toFixed(2));

      await savePortfolioMeta('main', {
        ...currentMeta,
        totalDeposited: updatedTotal,
        deposits: updatedDeposits,
      });

      setAmount('');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Erro ao guardar depósito no Firestore:', err);
      setError('Erro ao guardar no Firestore. Tenta novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        {/* Backdrop com desfoque e bloqueio do fundo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => !isSaving && onClose()}
          className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
        />

        {/* Balão centrado adaptado para toque iPhone 120Hz */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          className="relative w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col gap-4 z-10 select-none"
        >
          {/* Cabeçalho do balão: Novo depósito com X discreto à direita */}
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900 tracking-tight">Novo depósito</h3>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="p-1 text-slate-400 hover:text-slate-600 active:text-slate-900 active:scale-95 transition-all cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 stroke-[2]" />
            </button>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 text-rose-700 text-xs font-semibold rounded-xl border border-rose-100">
              {error}
            </div>
          )}

          {/* Campo Montante */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Montante
            </label>
            <div className="relative flex items-center bg-slate-50 rounded-2xl border border-slate-200 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 transition-all overflow-hidden px-3.5">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                autoFocus
                placeholder="0,00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full py-3.5 bg-transparent border-none text-2xl font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-0"
              />
              <span className="text-xl font-bold text-slate-400 select-none pr-1">€</span>
            </div>
          </div>

          {/* Campo Data do depósito */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Data do depósito
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[48px] px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all cursor-pointer"
            />
          </div>

          {/* Botão Confirmar depósito */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving || !amount}
            className="w-full min-h-[50px] mt-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>A registar no Firestore...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Confirmar depósito</span>
              </>
            )}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
