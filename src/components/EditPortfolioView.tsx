import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, Edit2, Trash2, Check, Loader2, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  fetchPortfolioMeta,
  savePortfolioMeta,
  saveHolding,
  removeHolding,
} from '../services/portfolioService';
import { HoldingDoc, PortfolioPosition, PurchaseRecord } from '../types';

interface DepositEntry {
  id: string;
  date: string;
  amount: number;
}

interface PurchaseItem {
  id: string;
  shares: number;
  price: number;
  priceEur: number;
  date: number | string;
}

interface EditPortfolioViewProps {
  onBack: () => void;
  onSyncComplete?: () => void;
  positions?: PortfolioPosition[];
  holdings?: HoldingDoc[];
}

export const EditPortfolioView: React.FC<EditPortfolioViewProps> = ({
  onBack,
  onSyncComplete,
  positions = [],
  holdings = [],
}) => {
  // Balão de Depósitos: pré-definido sempre minimizado
  const [isDepositsExpanded, setIsDepositsExpanded] = useState<boolean>(false);
  const [deposits, setDeposits] = useState<DepositEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Balões de Ativos: todos pré-definidos minimizados
  const [expandedTickers, setExpandedTickers] = useState<Record<string, boolean>>({});
  const [localHoldings, setLocalHoldings] = useState<HoldingDoc[]>(holdings);

  useEffect(() => {
    setLocalHoldings(holdings);
  }, [holdings]);

  // Swipe state para depósitos
  const [swipedDepositId, setSwipedDepositId] = useState<string | null>(null);
  const depositTouchStartXRef = useRef<number>(0);
  const depositTouchCurrentXRef = useRef<number>(0);
  const isDepositSwipingRef = useRef<boolean>(false);
  const [activeDepositDrag, setActiveDepositDrag] = useState<{ id: string; offset: number } | null>(null);

  // Edição de depósito
  const [editingDepositId, setEditingDepositId] = useState<string | null>(null);
  const [editDepositAmount, setEditDepositAmount] = useState<string>('');
  const [editDepositDate, setEditDepositDate] = useState<string>('');

  // Swipe state para compras de ativos (identificador único: `${ticker}__${purchaseId}`)
  const [swipedPurchaseKey, setSwipedPurchaseKey] = useState<string | null>(null);
  const purchaseTouchStartXRef = useRef<number>(0);
  const purchaseTouchCurrentXRef = useRef<number>(0);
  const isPurchaseSwipingRef = useRef<boolean>(false);
  const [activePurchaseDrag, setActivePurchaseDrag] = useState<{ key: string; offset: number } | null>(null);

  // Edição de compra de ativo
  const [editingPurchase, setEditingPurchase] = useState<{
    ticker: string;
    purchaseId: string;
    shares: string;
    price: string;
    date: string;
  } | null>(null);

  // Adicionar nova compra a um ativo (+ ao lado do Chevron)
  const [addingPurchaseForTicker, setAddingPurchaseForTicker] = useState<{
    ticker: string;
    shares: string;
    price: string;
    date: string;
  } | null>(null);

  // Carregar dados de depósitos
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setIsLoading(true);
        const meta = await fetchPortfolioMeta('main');
        if (meta && Array.isArray(meta.deposits)) {
          const formatted: DepositEntry[] = meta.deposits.map((d: any, idx: number) => {
            let dateStr = '';
            if (typeof d.date === 'string') {
              dateStr = d.date;
            } else if (typeof d.date === 'number') {
              dateStr = new Date(d.date).toLocaleDateString('pt-PT');
            } else {
              dateStr = new Date().toLocaleDateString('pt-PT');
            }

            return {
              id: d.id || `dep-${idx}-${dateStr}-${d.amount}`,
              date: dateStr,
              amount: Number(d.amount) || 0,
            };
          });

          if (isMounted) {
            setDeposits(formatted);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar depósitos no EditPortfolioView:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Total acumulado de depósitos
  const totalDeposited = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

  // Ordenar posições da maior para a mais pequena
  const sortedPositions = [...positions].sort((a, b) => (b.value || 0) - (a.value || 0));

  // Alternar balão de ativo
  const toggleAssetExpand = (ticker: string) => {
    setExpandedTickers((prev) => ({
      ...prev,
      [ticker]: !prev[ticker],
    }));
    setSwipedPurchaseKey(null);
    setEditingPurchase(null);
    setAddingPurchaseForTicker(null);
  };

  // Iniciar adição de nova compra para um ativo
  const handleStartAddPurchase = (ticker: string, defaultPrice: number) => {
    setEditingPurchase(null);
    setSwipedPurchaseKey(null);
    setAddingPurchaseForTicker({
      ticker,
      shares: '',
      price: defaultPrice ? defaultPrice.toString() : '',
      date: new Date().toISOString().split('T')[0],
    });
  };

  // Persistência de depósitos no Firestore
  const persistDeposits = async (newDepositsList: DepositEntry[]) => {
    try {
      setIsSaving(true);
      const currentMeta = await fetchPortfolioMeta('main');
      const newTotal = Number(
        newDepositsList.reduce((sum, d) => sum + (Number(d.amount) || 0), 0).toFixed(2)
      );

      const payloadDeposits = newDepositsList.map((d) => ({
        id: d.id,
        date: d.date,
        amount: Number(Number(d.amount).toFixed(2)),
      }));

      await savePortfolioMeta('main', {
        ...currentMeta,
        totalDeposited: newTotal,
        deposits: payloadDeposits,
      });

      setDeposits(newDepositsList);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      console.error('Erro ao guardar alterações de depósitos:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Apagar depósito
  const handleDeleteDeposit = async (idToDelete: string) => {
    const updated = deposits.filter((d) => d.id !== idToDelete);
    setSwipedDepositId(null);
    setActiveDepositDrag(null);
    await persistDeposits(updated);
  };

  // Iniciar edição de depósito
  const handleStartEditDeposit = (deposit: DepositEntry) => {
    setEditingDepositId(deposit.id);
    setEditDepositAmount(deposit.amount.toString());

    let ymd = '';
    if (deposit.date.includes('-') && deposit.date.split('-')[0].length === 4) {
      ymd = deposit.date;
    } else {
      const parts = deposit.date.split(/[/.]/);
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        ymd = `${year}-${month}-${day}`;
      } else {
        ymd = new Date().toISOString().split('T')[0];
      }
    }
    setEditDepositDate(ymd);
    setSwipedDepositId(null);
    setActiveDepositDrag(null);
  };

  // Guardar edição de depósito
  const handleSaveEditDeposit = async () => {
    if (!editingDepositId) return;
    const num = parseFloat(editDepositAmount.replace(',', '.'));
    if (isNaN(num) || num <= 0) return;

    let formattedDate = editDepositDate;
    if (editDepositDate.includes('-')) {
      const [y, m, d] = editDepositDate.split('-');
      if (y && m && d) {
        formattedDate = `${d}/${m}/${y}`;
      }
    }

    const updated = deposits.map((d) => {
      if (d.id === editingDepositId) {
        return {
          ...d,
          amount: Number(num.toFixed(2)),
          date: formattedDate || d.date,
        };
      }
      return d;
    });

    setEditingDepositId(null);
    await persistDeposits(updated);
  };

  // Gestos de Swipe para Depósitos
  const handleDepositTouchStart = (id: string, e: React.TouchEvent) => {
    if (editingDepositId === id) return;
    depositTouchStartXRef.current = e.touches[0].clientX;
    depositTouchCurrentXRef.current = e.touches[0].clientX;
    isDepositSwipingRef.current = true;
  };

  const handleDepositTouchMove = (id: string, e: React.TouchEvent) => {
    if (!isDepositSwipingRef.current || editingDepositId === id) return;
    depositTouchCurrentXRef.current = e.touches[0].clientX;
    const diff = depositTouchCurrentXRef.current - depositTouchStartXRef.current;
    const baseOffset = swipedDepositId === id ? -112 : 0;
    let newOffset = baseOffset + diff;
    if (newOffset > 0) newOffset = 0;
    if (newOffset < -120) newOffset = -120;
    setActiveDepositDrag({ id, offset: newOffset });
  };

  const handleDepositTouchEnd = (id: string) => {
    if (!isDepositSwipingRef.current || editingDepositId === id) return;
    isDepositSwipingRef.current = false;
    const diff = depositTouchCurrentXRef.current - depositTouchStartXRef.current;
    if (swipedDepositId === id) {
      if (diff > 30) setSwipedDepositId(null);
      else setSwipedDepositId(id);
    } else {
      if (diff < -40) setSwipedDepositId(id);
      else setSwipedDepositId(null);
    }
    setActiveDepositDrag(null);
  };

  // Obter lista de compras para um ativo
  const getAssetPurchases = (pos: PortfolioPosition): PurchaseItem[] => {
    const holding = localHoldings.find(
      (h) => h.ticker.toUpperCase() === pos.ticker.toUpperCase() || h.id === pos.id
    );

    if (holding && Array.isArray(holding.purchases) && holding.purchases.length > 0) {
      return holding.purchases.map((p, idx) => ({
        id: p.id || `p-${pos.ticker}-${idx}`,
        shares: Number(p.shares || 0),
        price: Number(p.price ?? pos.nativePrice ?? pos.currentPrice ?? 0),
        priceEur: Number(p.priceEur ?? p.price ?? pos.currentPrice ?? 0),
        date: p.date,
      }));
    }

    return [
      {
        id: `p-${pos.ticker}-init`,
        shares: Number(pos.shares || holding?.shares || 0),
        price: Number(pos.nativePrice || pos.currentPrice || 0),
        priceEur: Number(pos.currentPrice || 0),
        date: holding?.createdAt || Date.now(),
      },
    ];
  };

  // Gestos de Swipe para Compras de Ativos
  const handlePurchaseTouchStart = (key: string, e: React.TouchEvent) => {
    if (editingPurchase?.purchaseId === key) return;
    purchaseTouchStartXRef.current = e.touches[0].clientX;
    purchaseTouchCurrentXRef.current = e.touches[0].clientX;
    isPurchaseSwipingRef.current = true;
  };

  const handlePurchaseTouchMove = (key: string, e: React.TouchEvent) => {
    if (!isPurchaseSwipingRef.current || editingPurchase?.purchaseId === key) return;
    purchaseTouchCurrentXRef.current = e.touches[0].clientX;
    const diff = purchaseTouchCurrentXRef.current - purchaseTouchStartXRef.current;
    const baseOffset = swipedPurchaseKey === key ? -112 : 0;
    let newOffset = baseOffset + diff;
    if (newOffset > 0) newOffset = 0;
    if (newOffset < -120) newOffset = -120;
    setActivePurchaseDrag({ key, offset: newOffset });
  };

  const handlePurchaseTouchEnd = (key: string) => {
    if (!isPurchaseSwipingRef.current || editingPurchase?.purchaseId === key) return;
    isPurchaseSwipingRef.current = false;
    const diff = purchaseTouchCurrentXRef.current - purchaseTouchStartXRef.current;
    if (swipedPurchaseKey === key) {
      if (diff > 30) setSwipedPurchaseKey(null);
      else setSwipedPurchaseKey(key);
    } else {
      if (diff < -40) setSwipedPurchaseKey(key);
      else setSwipedPurchaseKey(null);
    }
    setActivePurchaseDrag(null);
  };

  // Iniciar edição de compra de ativo
  const handleStartEditPurchase = (ticker: string, purchase: PurchaseItem) => {
    let ymd = '';
    if (typeof purchase.date === 'number') {
      ymd = new Date(purchase.date).toISOString().split('T')[0];
    } else if (typeof purchase.date === 'string') {
      if (purchase.date.includes('-') && purchase.date.split('-')[0].length === 4) {
        ymd = purchase.date;
      } else {
        const parts = purchase.date.split(/[/.]/);
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          ymd = `${year}-${month}-${day}`;
        } else {
          ymd = new Date().toISOString().split('T')[0];
        }
      }
    } else {
      ymd = new Date().toISOString().split('T')[0];
    }

    setEditingPurchase({
      ticker,
      purchaseId: purchase.id,
      shares: purchase.shares.toString(),
      price: (purchase.priceEur || purchase.price || 0).toString(),
      date: ymd,
    });
    setAddingPurchaseForTicker(null);
    setSwipedPurchaseKey(null);
    setActivePurchaseDrag(null);
  };

  // Guardar edição de compra de ativo
  const handleSaveEditPurchase = async (pos: PortfolioPosition) => {
    if (!editingPurchase) return;
    const newShares = parseFloat(editingPurchase.shares.replace(',', '.'));
    const newPrice = parseFloat(editingPurchase.price.replace(',', '.'));
    if (isNaN(newShares) || newShares <= 0) return;

    const purchases = getAssetPurchases(pos);
    const dateTimestamp = editingPurchase.date
      ? new Date(editingPurchase.date).getTime()
      : Date.now();

    const updatedPurchases: PurchaseRecord[] = purchases.map((p) => {
      if (p.id === editingPurchase.purchaseId) {
        return {
          id: p.id,
          shares: Number(newShares),
          price: Number(newPrice || 0),
          priceEur: Number(newPrice || 0),
          date: dateTimestamp,
        };
      }
      return {
        id: p.id,
        shares: Number(p.shares),
        price: Number(p.price || 0),
        priceEur: Number(p.priceEur || 0),
        date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date),
      };
    });

    const totalShares = updatedPurchases.reduce((acc, p) => acc + Number(p.shares), 0);

    try {
      setIsSaving(true);
      await saveHolding('main', pos.ticker, totalShares, pos.color, updatedPurchases);

      setLocalHoldings((prev) =>
        prev.map((h) => {
          if (h.ticker.toUpperCase() === pos.ticker.toUpperCase()) {
            return {
              ...h,
              shares: totalShares,
              purchases: updatedPurchases,
            };
          }
          return h;
        })
      );

      setEditingPurchase(null);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      console.error('Erro ao salvar compra do ativo:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Guardar nova compra adicionada através do botão +
  const handleSaveNewPurchase = async (pos: PortfolioPosition) => {
    if (!addingPurchaseForTicker) return;
    const newShares = parseFloat(addingPurchaseForTicker.shares.replace(',', '.'));
    const newPrice = parseFloat(addingPurchaseForTicker.price.replace(',', '.'));
    if (isNaN(newShares) || newShares <= 0) return;

    const purchases = getAssetPurchases(pos);
    const dateTimestamp = addingPurchaseForTicker.date
      ? new Date(addingPurchaseForTicker.date).getTime()
      : Date.now();

    const newRecord: PurchaseRecord = {
      id: `p-${pos.ticker}-${Date.now()}`,
      shares: Number(newShares),
      price: Number(newPrice || 0),
      priceEur: Number(newPrice || 0),
      date: dateTimestamp,
    };

    const updatedPurchases: PurchaseRecord[] = [
      ...purchases.map((p) => ({
        id: p.id,
        shares: Number(p.shares),
        price: Number(p.price || 0),
        priceEur: Number(p.priceEur || 0),
        date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date),
      })),
      newRecord,
    ];

    const totalShares = updatedPurchases.reduce((acc, p) => acc + Number(p.shares), 0);

    try {
      setIsSaving(true);
      await saveHolding('main', pos.ticker, totalShares, pos.color, updatedPurchases);

      setLocalHoldings((prev) =>
        prev.map((h) => {
          if (h.ticker.toUpperCase() === pos.ticker.toUpperCase()) {
            return {
              ...h,
              shares: totalShares,
              purchases: updatedPurchases,
            };
          }
          return h;
        })
      );

      setAddingPurchaseForTicker(null);
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      console.error('Erro ao adicionar nova compra do ativo:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Apagar compra de ativo
  const handleDeletePurchase = async (pos: PortfolioPosition, purchaseId: string) => {
    const purchases = getAssetPurchases(pos);
    const remainingPurchases = purchases
      .filter((p) => p.id !== purchaseId)
      .map((p) => ({
        id: p.id,
        shares: Number(p.shares),
        price: Number(p.price || 0),
        priceEur: Number(p.priceEur || 0),
        date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date),
      }));

    const totalShares = remainingPurchases.reduce((acc, p) => acc + Number(p.shares), 0);

    setSwipedPurchaseKey(null);
    setActivePurchaseDrag(null);

    try {
      setIsSaving(true);
      if (remainingPurchases.length === 0 || totalShares <= 0) {
        await removeHolding('main', pos.ticker);
        setLocalHoldings((prev) =>
          prev.filter((h) => h.ticker.toUpperCase() !== pos.ticker.toUpperCase())
        );
      } else {
        await saveHolding('main', pos.ticker, totalShares, pos.color, remainingPurchases);
        setLocalHoldings((prev) =>
          prev.map((h) => {
            if (h.ticker.toUpperCase() === pos.ticker.toUpperCase()) {
              return {
                ...h,
                shares: totalShares,
                purchases: remainingPurchases,
              };
            }
            return h;
          })
        );
      }

      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      console.error('Erro ao apagar compra do ativo:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Formatar data para exibição
  const formatDisplayDate = (dateVal: number | string): string => {
    if (!dateVal) return '';
    if (typeof dateVal === 'number') {
      return new Date(dateVal).toLocaleDateString('pt-PT');
    }
    if (typeof dateVal === 'string') {
      if (dateVal.includes('-')) {
        const parts = dateVal.split('-');
        if (parts.length === 3 && parts[0].length === 4) {
          return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
      }
      return dateVal;
    }
    return '';
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
      className="w-full h-full flex flex-col p-4 pb-28 relative overflow-y-auto"
    >
      {/* Botão X discreto no topo direito sem bolinha */}
      <div className="w-full flex justify-end pt-2 pb-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="p-2 text-slate-400 hover:text-slate-600 active:text-slate-900 active:scale-95 transition-all cursor-pointer"
          aria-label="Voltar"
        >
          <X className="w-6 h-6 stroke-[2]" />
        </button>
      </div>

      <div className="w-full max-w-sm mx-auto flex flex-col gap-3.5">
        {/* PRIMEIRO BALÃO: Depósitos */}
        <div className="w-full bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden transition-all">
          {/* Cabeçalho do Balão de Depósitos */}
          <button
            type="button"
            onClick={() => {
              setIsDepositsExpanded((prev) => !prev);
              setSwipedDepositId(null);
              setEditingDepositId(null);
            }}
            className="w-full p-4 flex items-center justify-between text-left cursor-pointer active:bg-slate-50 transition-colors select-none"
          >
            {/* Esquerda: Depósitos e número de entradas SEM parênteses */}
            <div className="flex flex-col min-w-0 pr-2">
              <span className="font-bold text-base text-slate-900 tracking-tight">
                Depósitos
              </span>
              <span className="text-[11px] font-medium text-slate-400 mt-0.5">
                {deposits.length} {deposits.length === 1 ? 'entrada' : 'entradas'}
              </span>
            </div>

            {/* Direita: Total aportado e seta limpa sem contornos */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-bold text-sm text-slate-900 tracking-tight">
                {totalDeposited.toLocaleString('pt-PT', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                €
              </span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 stroke-[2] transition-transform duration-200 ${
                  isDepositsExpanded ? 'rotate-180' : ''
                }`}
              />
            </div>
          </button>

          {/* Conteúdo do Balão de Depósitos */}
          <AnimatePresence initial={false}>
            {isDepositsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
                className="overflow-hidden border-t border-slate-100 divide-y divide-slate-100 bg-white"
              >
                {isLoading ? (
                  <div className="py-6 flex items-center justify-center text-slate-400 gap-2 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>A carregar depósitos...</span>
                  </div>
                ) : deposits.length === 0 ? (
                  <div className="py-6 px-4 text-center text-xs text-slate-400 font-medium">
                    Sem depósitos registados
                  </div>
                ) : (
                  deposits.map((item) => {
                    const isEditing = editingDepositId === item.id;
                    const isSwiped = swipedDepositId === item.id;
                    const dragOffset =
                      activeDepositDrag?.id === item.id
                        ? activeDepositDrag.offset
                        : isSwiped
                        ? -112
                        : 0;

                    return (
                      <div
                        key={item.id}
                        className="relative w-full h-14 overflow-hidden bg-slate-100 select-none"
                      >
                        {/* Botões de Ação no Swipe (Editar e Lixo) */}
                        {!isEditing && (
                          <div className="absolute top-0 bottom-0 right-0 flex items-center h-full">
                            <button
                              type="button"
                              onClick={() => handleStartEditDeposit(item)}
                              className="h-full w-14 bg-sky-500 text-white flex items-center justify-center active:bg-sky-600 transition-colors cursor-pointer"
                              aria-label="Editar depósito"
                            >
                              <Edit2 className="w-4 h-4 stroke-[2.2]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDeposit(item.id)}
                              className="h-full w-14 bg-rose-500 text-white flex items-center justify-center active:bg-rose-600 transition-colors cursor-pointer"
                              aria-label="Apagar depósito"
                            >
                              <Trash2 className="w-4 h-4 stroke-[2.2]" />
                            </button>
                          </div>
                        )}

                        {/* Linha Principal com Suporte a Swipe */}
                        <div
                          onTouchStart={(e) => handleDepositTouchStart(item.id, e)}
                          onTouchMove={(e) => handleDepositTouchMove(item.id, e)}
                          onTouchEnd={() => handleDepositTouchEnd(item.id)}
                          style={{
                            transform: isEditing ? 'none' : `translateX(${dragOffset}px)`,
                            transition:
                              activeDepositDrag?.id === item.id
                                ? 'none'
                                : 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
                          }}
                          className="relative z-10 w-full h-full bg-white px-4 flex items-center justify-between"
                        >
                          {isEditing ? (
                            <div className="w-full h-full flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-400">€</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editDepositAmount}
                                  onChange={(e) => setEditDepositAmount(e.target.value)}
                                  className="w-20 py-1 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-sky-500"
                                  placeholder="0.00"
                                  autoFocus
                                />
                                <input
                                  type="date"
                                  value={editDepositDate}
                                  onChange={(e) => setEditDepositDate(e.target.value)}
                                  className="w-28 py-1 px-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-600 focus:outline-none focus:border-sky-500"
                                />
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={handleSaveEditDeposit}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 active:scale-95 rounded-lg transition-all"
                                  aria-label="Confirmar alteração"
                                >
                                  <Check className="w-4 h-4 stroke-[2.5]" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingDepositId(null)}
                                  className="p-1.5 text-slate-400 hover:bg-slate-100 active:scale-95 rounded-lg transition-all"
                                  aria-label="Cancelar alteração"
                                >
                                  <X className="w-4 h-4 stroke-[2]" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-sm text-slate-900 tracking-tight">
                                  {item.amount.toLocaleString('pt-PT', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  €
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 font-medium">
                                  {item.date}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* BALÕES DE ATIVOS: Continuação da página, ordenados da maior posição para a menor */}
        {sortedPositions.map((pos) => {
          const isExpanded = Boolean(expandedTickers[pos.ticker]);
          const purchases = getAssetPurchases(pos);
          const isAddingToThis = addingPurchaseForTicker?.ticker === pos.ticker;

          return (
            <div
              key={pos.ticker}
              className="w-full bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden transition-all"
            >
              {/* Cabeçalho do Balão do Ativo */}
              <button
                type="button"
                onClick={() => toggleAssetExpand(pos.ticker)}
                className="w-full p-4 flex items-center justify-between text-left cursor-pointer active:bg-slate-50 transition-colors select-none"
              >
                {/* Esquerda: Ticker na cor do chart (apenas letras) e nome discreto por baixo */}
                <div className="flex flex-col min-w-0 pr-2">
                  <span
                    className="font-bold text-base tracking-tight"
                    style={{ color: pos.color }}
                  >
                    {pos.ticker}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 mt-0.5 truncate max-w-[190px]">
                    {pos.name || pos.ticker}
                  </span>
                </div>

                {/* Direita: Valor total na carteira, botão + (se expandido) e seta discreta sem contornos */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="font-bold text-sm text-slate-900 tracking-tight">
                    €
                    {pos.value.toLocaleString('pt-PT', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>

                  {/* Botão + ao lado do Chevron ao maximizar */}
                  {isExpanded && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartAddPurchase(pos.ticker, pos.nativePrice || pos.currentPrice || 0);
                      }}
                      className="p-1 text-slate-500 hover:text-slate-800 active:scale-90 transition-transform cursor-pointer rounded-md hover:bg-slate-100 flex items-center justify-center"
                      title="Adicionar ação"
                      aria-label="Adicionar ação"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                    </span>
                  )}

                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 stroke-[2] transition-transform duration-200 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Conteúdo do Balão: Formulário de nova compra + Compras existentes */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
                    className="overflow-hidden border-t border-slate-100 divide-y divide-slate-100 bg-white"
                  >
                    {/* Formulário Inline para ADICIONAR nova compra (+ ao lado do Chevron) */}
                    {isAddingToThis && addingPurchaseForTicker && (
                      <div className="w-full bg-slate-50/90 p-3.5 flex flex-col gap-2.5 border-b border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">
                            Adicionar compra em {pos.ticker}
                          </span>
                          <button
                            type="button"
                            onClick={() => setAddingPurchaseForTicker(null)}
                            className="p-1 text-slate-400 hover:text-slate-600 active:scale-95 cursor-pointer"
                          >
                            <X className="w-4 h-4 stroke-[2]" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                              Unidades
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={addingPurchaseForTicker.shares}
                              onChange={(e) =>
                                setAddingPurchaseForTicker({
                                  ...addingPurchaseForTicker,
                                  shares: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-sky-500"
                              placeholder="0"
                              autoFocus
                            />
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                              Preço unitário (€)
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={addingPurchaseForTicker.price}
                              onChange={(e) =>
                                setAddingPurchaseForTicker({
                                  ...addingPurchaseForTicker,
                                  price: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-sky-500"
                              placeholder="0.00"
                            />
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                            Data da compra
                          </span>
                          <input
                            type="date"
                            value={addingPurchaseForTicker.date}
                            onChange={(e) =>
                              setAddingPurchaseForTicker({
                                ...addingPurchaseForTicker,
                                date: e.target.value,
                              })
                            }
                            className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-sky-500"
                          />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setAddingPurchaseForTicker(null)}
                            className="h-8 px-3 text-slate-500 hover:text-slate-700 active:scale-95 text-xs font-medium cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveNewPurchase(pos)}
                            disabled={isSaving}
                            className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-bold text-xs"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Guardar</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {purchases.length === 0 && !isAddingToThis ? (
                      <div className="py-6 px-4 text-center text-xs text-slate-400 font-medium">
                        Sem compras registadas para este ativo
                      </div>
                    ) : (
                      purchases.map((purchase) => {
                        const rowKey = `${pos.ticker}__${purchase.id}`;
                        const isEditingThis =
                          editingPurchase?.ticker === pos.ticker &&
                          editingPurchase?.purchaseId === purchase.id;
                        const isSwiped = swipedPurchaseKey === rowKey;
                        const dragOffset =
                          activePurchaseDrag?.key === rowKey
                            ? activePurchaseDrag.offset
                            : isSwiped
                            ? -112
                            : 0;

                        const totalAportado =
                          purchase.shares *
                          (purchase.priceEur || purchase.price || pos.currentPrice || 0);

                        return (
                          <div
                            key={purchase.id}
                            className="relative w-full overflow-hidden bg-slate-100 select-none transition-all"
                          >
                            {/* Ações no Swipe Left: Editar e Apagar */}
                            {!isEditingThis && (
                              <div className="absolute top-0 bottom-0 right-0 flex items-center h-full">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditPurchase(pos.ticker, purchase)}
                                  className="h-full w-14 bg-sky-500 text-white flex items-center justify-center active:bg-sky-600 transition-colors cursor-pointer"
                                  aria-label="Editar compra"
                                >
                                  <Edit2 className="w-4 h-4 stroke-[2.2]" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePurchase(pos, purchase.id)}
                                  className="h-full w-14 bg-rose-500 text-white flex items-center justify-center active:bg-rose-600 transition-colors cursor-pointer"
                                  aria-label="Apagar compra"
                                >
                                  <Trash2 className="w-4 h-4 stroke-[2.2]" />
                                </button>
                              </div>
                            )}

                            {/* Linha da Compra */}
                            <div
                              onTouchStart={(e) => handlePurchaseTouchStart(rowKey, e)}
                              onTouchMove={(e) => handlePurchaseTouchMove(rowKey, e)}
                              onTouchEnd={() => handlePurchaseTouchEnd(rowKey)}
                              style={{
                                transform: isEditingThis ? 'none' : `translateX(${dragOffset}px)`,
                                transition:
                                  activePurchaseDrag?.key === rowKey
                                    ? 'none'
                                    : 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
                              }}
                              className={`relative z-10 w-full ${
                                isEditingThis
                                  ? 'bg-slate-50/90 p-3.5 flex flex-col gap-2.5'
                                  : 'h-14 bg-white px-4 flex items-center justify-between'
                              }`}
                            >
                              {isEditingThis ? (
                                /* Formulário de Edição Inline limpo e sem sobreposição */
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-800">
                                      Editar compra
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setEditingPurchase(null)}
                                      className="p-1 text-slate-400 hover:text-slate-600 active:scale-95 cursor-pointer"
                                    >
                                      <X className="w-4 h-4 stroke-[2]" />
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2.5">
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                        Unidades
                                      </span>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editingPurchase.shares}
                                        onChange={(e) =>
                                          setEditingPurchase({
                                            ...editingPurchase,
                                            shares: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-sky-500"
                                        placeholder="0"
                                        autoFocus
                                      />
                                    </div>
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                        Preço unitário (€)
                                      </span>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editingPurchase.price}
                                        onChange={(e) =>
                                          setEditingPurchase({
                                            ...editingPurchase,
                                            price: e.target.value,
                                          })
                                        }
                                        className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-sky-500"
                                        placeholder="0.00"
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                      Data da compra
                                    </span>
                                    <input
                                      type="date"
                                      value={editingPurchase.date}
                                      onChange={(e) =>
                                        setEditingPurchase({
                                          ...editingPurchase,
                                          date: e.target.value,
                                        })
                                      }
                                      className="w-full h-8 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-sky-500"
                                    />
                                  </div>

                                  <div className="flex items-center justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingPurchase(null)}
                                      className="h-8 px-3 text-slate-500 hover:text-slate-700 active:scale-95 text-xs font-medium cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditPurchase(pos)}
                                      disabled={isSaving}
                                      className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-bold text-xs"
                                    >
                                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                      <span>Guardar</span>
                                    </button>
                                  </div>
                                </>
                              ) : (
                                /* Modo Normal: Unidades a negrito e ao lado o valor aportado sem estar a negrito */
                                <>
                                  <div className="flex items-baseline gap-2 min-w-0">
                                    <span className="font-bold text-sm text-slate-900 tracking-tight">
                                      {purchase.shares} un
                                    </span>
                                    <span className="text-sm text-slate-500 font-normal">
                                      €
                                      {totalAportado.toLocaleString('pt-PT', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-slate-400 font-medium">
                                      {formatDisplayDate(purchase.date)}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};
