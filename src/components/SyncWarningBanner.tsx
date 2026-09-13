import React, { useState } from 'react';
import { AlertTriangle, Clock, X, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DailySnapshotDoc } from '../types';

interface SyncWarningBannerProps {
  snapshots: DailySnapshotDoc[];
}

/**
 * Verifica se a sincronização automática diária falhou por 2 ou mais dias úteis.
 * Considera fins de semana (sábado e domingo) para não emitir falsos alarmes quando as bolsas fecham.
 */
export const SyncWarningBanner: React.FC<SyncWarningBannerProps> = ({ snapshots }) => {
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  if (isDismissed || !snapshots || snapshots.length === 0) {
    return null;
  }

  // Obter o último snapshot gravado
  const lastSnapshot = snapshots[snapshots.length - 1];
  const lastTimestamp =
    lastSnapshot.timestamp || (lastSnapshot.date ? new Date(lastSnapshot.date).getTime() : 0);

  if (!lastTimestamp || isNaN(lastTimestamp)) {
    return null;
  }

  const now = Date.now();
  const diffMs = now - lastTimestamp;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Considerar aviso se passaram mais de 2.2 dias (para permitir o ciclo normal diário de 24h a 48h)
  // Se for fim de semana (por exemplo, último snapshot na sexta-feira à noite), damos tolerância extra de 2 dias.
  const lastDate = new Date(lastTimestamp);
  const dayOfWeek = lastDate.getUTCDay(); // 5 = Sexta-feira
  const thresholdDays = dayOfWeek === 5 ? 4.2 : 2.2;

  if (diffDays <= thresholdDays) {
    return null; // Está em dia, não mostrar aviso
  }

  const formattedLastDate = lastDate.toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const daysMissed = Math.floor(diffDays);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="w-full mb-3 p-3.5 bg-amber-50/90 border border-amber-200/80 rounded-2xl flex items-start gap-3 text-amber-900 shadow-xs"
      >
        <div className="p-1.5 bg-amber-100 rounded-xl text-amber-600 shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4 stroke-[2.5]" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
              Aviso de Sincronização
            </h4>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="text-amber-500 hover:text-amber-800 p-0.5 -mr-1 transition-colors cursor-pointer"
              aria-label="Fechar aviso"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>

          <p className="text-xs text-amber-900/90 leading-relaxed">
            A automação diária do GitHub não regista dados há{' '}
            <strong className="font-bold">{daysMissed} dias</strong>.
          </p>

          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 mt-1">
            <Clock className="w-3 h-3 text-amber-600 shrink-0" />
            <span>Último registo: {formattedLastDate}</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
