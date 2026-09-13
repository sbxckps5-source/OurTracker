import React, { useState } from 'react';
import { ClientPortfolioData } from '../utils/clientPortfolioLoader';
import { Calendar, DollarSign, Loader2, CloudUpload, CheckCircle2, AlertCircle } from 'lucide-react';
import { uploadClientPortfolioToCloud } from '../services/portfolioService';

interface ClientPortfolioViewProps {
  data: ClientPortfolioData;
  isLoadingQuotes: boolean;
  onUploadNew: () => void;
  onUploadCloudSuccess?: () => void;
}

export const ClientPortfolioView: React.FC<ClientPortfolioViewProps> = ({
  data,
  isLoadingQuotes,
  onUploadNew,
  onUploadCloudSuccess,
}) => {
  const [isUploadingCloud, setIsUploadingCloud] = useState<boolean>(false);
  const [cloudSuccess, setCloudSuccess] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return 'N/D';
    return `€${val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPrice = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return 'N/D';
    return `€${val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  };

  const formatPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return 'N/D';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const handleUploadToCloud = async () => {
    setCloudError(null);
    setIsUploadingCloud(true);
    try {
      await uploadClientPortfolioToCloud('main', data);
      setCloudSuccess(true);
      if (onUploadCloudSuccess) {
        onUploadCloudSuccess();
      }
      setTimeout(() => {
        setCloudSuccess(false);
      }, 4000);
    } catch (err: any) {
      console.error('Erro ao enviar para a nuvem:', err);
      setCloudError(err?.message || 'Erro ao guardar na nuvem. Tenta novamente.');
    } finally {
      setIsUploadingCloud(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 pb-20">
      {/* Notificação de Sucesso no Upload para a Nuvem */}
      {cloudSuccess && (
        <div className="w-full p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2.5 text-xs font-semibold shadow-xs animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>Portfólio enviado para a nuvem com sucesso! Os ativos já estão sincronizados.</span>
        </div>
      )}

      {/* Notificação de Erro */}
      {cloudError && (
        <div className="w-full p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2.5 text-xs font-semibold shadow-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{cloudError}</span>
        </div>
      )}

      {/* Ações Rápidas: Upload para a Nuvem & Carregar Novo Ficheiro */}
      <div className="w-full flex items-center justify-between gap-2.5 bg-slate-900 text-white rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <CloudUpload className="w-4 h-4 text-rose-400" />
            Sincronização na Nuvem
          </span>
          <span className="text-[11px] text-slate-400">
            {data.positions.length} ativos prontos a enviar
          </span>
        </div>

        <button
          type="button"
          onClick={handleUploadToCloud}
          disabled={isUploadingCloud || data.positions.length === 0}
          className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          {isUploadingCloud ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>A enviar...</span>
            </>
          ) : (
            <>
              <CloudUpload className="w-3.5 h-3.5" />
              <span>Upload para a Nuvem</span>
            </>
          )}
        </button>
      </div>

      {/* 5. UI - Resumo no topo */}
      <div className="grid grid-cols-2 gap-3 w-full">
        {/* Total depositado */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-slate-500 mb-1">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total depositado</span>
          </div>
          <div className="text-xl font-bold text-slate-900 tabular-nums">
            {formatCurrency(data.totalDeposited)}
          </div>
          {data.oldestDepositDate && (
            <span className="text-[10px] text-slate-400 mt-1">
              Desde {data.oldestDepositDate.toLocaleDateString('pt-PT')}
            </span>
          )}
        </div>

        {/* Dias investidos */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-slate-500 mb-1">
            <Calendar className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-semibold uppercase tracking-wider">Dias investidos</span>
          </div>
          <div className="text-xl font-bold text-slate-900 tabular-nums">
            {data.investedDays} {data.investedDays === 1 ? 'dia' : 'dias'}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            Calculado até hoje
          </span>
        </div>
      </div>

      {/* Indicador de carregamento de cotações Yahoo Finance */}
      {isLoadingQuotes && (
        <div className="w-full py-2.5 px-3.5 rounded-xl bg-sky-50 border border-sky-200/80 text-sky-800 text-xs font-medium flex items-center gap-2 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
          <span>A carregar cotações...</span>
        </div>
      )}

      {/* Tabela / Lista de Posições Abertas (Otimizada para iPhone e Ecrãs Maiores) */}
      <div className="w-full bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col">
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">Posições Abertas</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {data.positions.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onUploadNew}
            className="text-xs font-semibold text-sky-600 hover:text-sky-700 cursor-pointer"
          >
            Carregar outro
          </button>
        </div>

        {data.positions.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Nenhuma posição aberta agregada encontrada no ficheiro.
          </div>
        ) : (
          <div className="w-full">
            {/* Modo Lista / Cartões compacto perfeito para tela estreita de iPhone */}
            <div className="divide-y divide-slate-100 sm:hidden">
              {data.positions.map((pos) => {
                const hasProfit = pos.profitEur !== null && pos.profitEur !== undefined;
                const isPositive = hasProfit && pos.profitEur! >= 0;
                const isNegative = hasProfit && pos.profitEur! < 0;

                return (
                  <div key={pos.id} className="p-3.5 flex flex-col gap-2 hover:bg-slate-50/50 transition-colors">
                    {/* Linha Superior: Ticker + Preço / Lucro em Destaque */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                          {pos.ticker}
                          {pos.yahooTicker !== pos.ticker && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({pos.yahooTicker})
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate max-w-[180px]" title={pos.name}>
                          {pos.name}
                        </span>
                      </div>

                      <div className="flex flex-col items-end text-right flex-shrink-0">
                        <span className="text-xs font-bold text-slate-900 tabular-nums">
                          {pos.isLoadingPrice ? (
                            <span className="text-slate-400 inline-flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                            </span>
                          ) : pos.currentPrice !== null ? (
                            formatPrice(pos.currentPrice)
                          ) : (
                            'N/D'
                          )}
                        </span>
                        <span
                          className={`text-[11px] font-bold tabular-nums ${
                            isPositive
                              ? 'text-emerald-600'
                              : isNegative
                              ? 'text-rose-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {pos.isLoadingPrice ? (
                            '...'
                          ) : pos.profitEur !== null ? (
                            `${formatCurrency(pos.profitEur)} (${formatPercent(pos.profitPercent)})`
                          ) : (
                            'N/D'
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Linha Inferior: Quantidade e Valor Investido */}
                    <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-50 text-slate-500">
                      <div>
                        <span>Qtd: </span>
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {pos.volume.toLocaleString('pt-PT', { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                      <div>
                        <span>Investido: </span>
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {formatCurrency(pos.value)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modo Tabela com scroll horizontal suave para ecrãs maiores que telemóvel */}
            <div className="hidden sm:block w-full overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-100 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Ticker</th>
                    <th className="py-2.5 px-3">Nome</th>
                    <th className="py-2.5 px-3 text-right">Volume</th>
                    <th className="py-2.5 px-3 text-right">Valor investido</th>
                    <th className="py-2.5 px-3 text-right">Preço atual</th>
                    <th className="py-2.5 px-3 text-right">Lucro (€)</th>
                    <th className="py-2.5 px-3 text-right">Lucro (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800 font-medium">
                  {data.positions.map((pos) => {
                    const hasProfit = pos.profitEur !== null && pos.profitEur !== undefined;
                    const isPositive = hasProfit && pos.profitEur! >= 0;
                    const isNegative = hasProfit && pos.profitEur! < 0;

                    return (
                      <tr key={pos.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Ticker */}
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-col">
                            <span>{pos.ticker}</span>
                            {pos.yahooTicker !== pos.ticker && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                Yahoo: {pos.yahooTicker}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Nome */}
                        <td className="py-3 px-3 text-slate-600 max-w-[140px] truncate" title={pos.name}>
                          {pos.name}
                        </td>

                        {/* Volume */}
                        <td className="py-3 px-3 text-right tabular-nums">
                          {pos.volume.toLocaleString('pt-PT', { maximumFractionDigits: 4 })}
                        </td>

                        {/* Valor investido */}
                        <td className="py-3 px-3 text-right tabular-nums text-slate-900 font-semibold">
                          {formatCurrency(pos.value)}
                        </td>

                        {/* Preço atual */}
                        <td className="py-3 px-3 text-right tabular-nums font-semibold">
                          {pos.isLoadingPrice ? (
                            <span className="text-slate-400 inline-flex items-center gap-1 justify-end">
                              <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                              ...
                            </span>
                          ) : pos.currentPrice !== null ? (
                            formatPrice(pos.currentPrice)
                          ) : (
                            <span className="text-slate-400 font-normal">N/D</span>
                          )}
                        </td>

                        {/* Lucro (€) */}
                        <td
                          className={`py-3 px-3 text-right tabular-nums font-bold ${
                            isPositive
                              ? 'text-emerald-600'
                              : isNegative
                              ? 'text-rose-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {pos.isLoadingPrice ? (
                            <span className="text-slate-400 font-normal">...</span>
                          ) : pos.profitEur !== null ? (
                            formatCurrency(pos.profitEur)
                          ) : (
                            <span className="text-slate-400 font-normal">N/D</span>
                          )}
                        </td>

                        {/* Lucro (%) */}
                        <td
                          className={`py-3 px-3 text-right tabular-nums font-bold ${
                            isPositive
                              ? 'text-emerald-600'
                              : isNegative
                              ? 'text-rose-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {pos.isLoadingPrice ? (
                            <span className="text-slate-400 font-normal">...</span>
                          ) : pos.profitPercent !== null ? (
                            formatPercent(pos.profitPercent)
                          ) : (
                            <span className="text-slate-400 font-normal">N/D</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
