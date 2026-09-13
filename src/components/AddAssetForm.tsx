import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, Check, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { saveHolding, DISTINCT_PALETTE } from '../services/portfolioService';
import { PurchaseRecord } from '../types';

interface SearchResultItem {
  symbol: string;
  shortname: string;
  longname: string;
  exchange: string;
  quoteType: string;
}

interface PurchaseItemInput {
  id: string;
  shares: string;
  price: string;
  date: string;
}

interface AddAssetFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

export const AddAssetForm: React.FC<AddAssetFormProps> = ({ onBack, onSuccess }) => {
  // 1. Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<SearchResultItem | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 2. Purchases state: each row has units, price, date
  const [purchases, setPurchases] = useState<PurchaseItemInput[]>([
    {
      id: `p-${Date.now()}-0`,
      shares: '',
      price: '',
      date: new Date().toISOString().split('T')[0],
    },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time search with debounce
  useEffect(() => {
    if (selectedAsset) return; // don't search if asset is already selected

    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const quotes: SearchResultItem[] = data.quotes || [];
          setSearchResults(quotes);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.warn('Erro ao pesquisar ativo:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, selectedAsset]);

  const handleSelectAsset = (item: SearchResultItem) => {
    setSelectedAsset(item);
    setSearchQuery(item.symbol);
    setSearchResults([]);
    setErrorMessage(null);
  };

  const handleClearSelected = () => {
    setSelectedAsset(null);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Add more purchase entries
  const handleAddMore = () => {
    setPurchases((prev) => [
      ...prev,
      {
        id: `p-${Date.now()}-${prev.length}`,
        shares: '',
        price: '',
        date: new Date().toISOString().split('T')[0],
      },
    ]);
  };

  const handleRemovePurchase = (index: number) => {
    if (purchases.length <= 1) return;
    setPurchases((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdatePurchase = (index: number, field: keyof PurchaseItemInput, rawValue: string) => {
    // Permitir tanto ponto como vírgula nos campos numéricos
    let value = rawValue;
    if (field === 'shares' || field === 'price') {
      // Manter apenas dígitos, pontos ou vírgulas (máximo 1 separador decimal)
      value = value.replace(/[^0-9.,]/g, '');
      // Se tiver mais que um separador decimal, manter apenas o primeiro
      const firstSepMatch = value.match(/[.,]/);
      if (firstSepMatch && firstSepMatch.index !== undefined) {
        const firstSep = firstSepMatch[0];
        const before = value.slice(0, firstSepMatch.index);
        const after = value.slice(firstSepMatch.index + 1).replace(/[.,]/g, '');
        value = `${before}${firstSep}${after}`;
      }
    }

    setPurchases((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
    if (errorMessage) setErrorMessage(null);
  };

  // Save asset to Firestore
  const handleSaveAsset = async () => {
    const rawTicker = selectedAsset ? selectedAsset.symbol : searchQuery.trim();
    if (!rawTicker) {
      setErrorMessage('Por favor, pesquisa e seleciona um ativo.');
      return;
    }

    // Validate purchases
    const parsedPurchases: PurchaseRecord[] = [];
    let totalShares = 0;

    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      const sharesNum = parseFloat(p.shares.replace(',', '.'));
      const priceNum = parseFloat(p.price.replace(',', '.'));

      if (isNaN(sharesNum) || sharesNum <= 0) {
        setErrorMessage(`Por favor, introduz as unidades na compra #${i + 1}.`);
        return;
      }
      if (isNaN(priceNum) || priceNum <= 0) {
        setErrorMessage(`Por favor, introduz o preço da ação na compra #${i + 1}.`);
        return;
      }
      if (!p.date) {
        setErrorMessage(`Por favor, indica a data da compra #${i + 1}.`);
        return;
      }

      const timestamp = new Date(p.date).getTime() || Date.now();
      totalShares += sharesNum;

      parsedPurchases.push({
        id: p.id,
        shares: Number(sharesNum.toFixed(6)),
        price: Number(priceNum.toFixed(4)),
        priceEur: Number(priceNum.toFixed(4)),
        date: timestamp,
      });
    }

    if (totalShares <= 0) {
      setErrorMessage('O total de unidades tem de ser maior que 0.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);

      // Obter taxa de câmbio e moeda atual do ativo
      let fxRate = 1.0;
      let currency = 'EUR';
      try {
        const quoteRes = await fetch(`/api/quote/${encodeURIComponent(rawTicker)}`);
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          fxRate = Number(quoteData.fxRateToEur || 1.0);
          currency = (quoteData.currency || 'EUR').toUpperCase();
        }
      } catch (e) {
        console.warn('Não foi possível obter taxa de câmbio, a usar 1.0', e);
      }

      const isGBp = currency === 'GBP' || currency === 'GBp';

      // Atualizar priceEur com base no fxRate e moeda
      for (let i = 0; i < parsedPurchases.length; i++) {
        const p = parsedPurchases[i];
        const computedEur = isGBp ? (p.price / 100) * fxRate : p.price * fxRate;
        parsedPurchases[i].priceEur = Number(computedEur.toFixed(4));
      }

      const normalizedTicker = rawTicker.toUpperCase();
      const existingDocRef = doc(db, 'portfolios', 'main', 'holdings', normalizedTicker);
      const existingSnap = await getDoc(existingDocRef);

      let existingPurchases: PurchaseRecord[] = [];
      let finalShares = totalShares;
      let holdingColor = DISTINCT_PALETTE[Math.floor(Math.random() * DISTINCT_PALETTE.length)];

      if (existingSnap.exists()) {
        const data = existingSnap.data();
        if (Array.isArray(data.purchases)) {
          existingPurchases = data.purchases;
        }
        finalShares = Number((Number(data.shares || 0) + totalShares).toFixed(6));
        if (data.color) holdingColor = data.color;
      }

      const mergedPurchases = [...existingPurchases, ...parsedPurchases];

      // Save directly to Firestore holding document
      await saveHolding(
        'main',
        normalizedTicker,
        finalShares,
        holdingColor,
        mergedPurchases
      );

      onSuccess();
    } catch (err: any) {
      console.error('Erro ao guardar ativo no Firestore:', err);
      setErrorMessage('Erro ao guardar no Firestore. Verifica a ligação.');
    } finally {
      setIsSaving(false);
    }
  };

  const getCleanQuoteType = (type?: string) => {
    if (!type) return '';
    const t = type.toUpperCase();
    if (t === 'EQUITY') return 'Stock';
    if (t === 'ETF') return 'ETF';
    if (t === 'MUTUALFUND') return 'Fundo';
    if (t === 'CRYPTOCURRENCY') return 'Crypto';
    if (t === 'CURRENCY') return 'FX';
    if (t === 'INDEX') return 'Índice';
    return type;
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
      <div className="w-full flex justify-end pt-2 pb-1">
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

      <div className="w-full max-w-sm mx-auto flex flex-col gap-4">
        {/* Barra de pesquisa em tempo real ou Ativo Selecionado */}
        {!selectedAsset ? (
          <div className="flex flex-col gap-1 relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Pesquisar ativo
            </label>
            <div className="relative flex items-center bg-slate-50 rounded-2xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3.5">
              <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2" />
              <input
                type="text"
                autoFocus
                placeholder="Ex: AAPL, VWCE, Microsoft..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="w-full py-3 bg-transparent border-none text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
              {isSearching && <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0 ml-1" />}
            </div>

            {/* Lista de resultados da pesquisa */}
            {searchResults.length > 0 && (
              <div className="absolute top-[102%] left-0 right-0 z-30 bg-white rounded-2xl border border-slate-200 shadow-xl max-h-60 overflow-y-auto divide-y divide-slate-100">
                {searchResults.map((item) => {
                  const badgeType = getCleanQuoteType(item.quoteType);
                  return (
                    <button
                      key={`${item.symbol}-${item.exchange}`}
                      type="button"
                      onClick={() => handleSelectAsset(item)}
                      className="w-full text-left p-3 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Ticker destacado */}
                        <span className="font-extrabold text-sm text-slate-900 tracking-tight shrink-0">
                          {item.symbol}
                        </span>
                        {/* Tipo discreto ao lado do ticker */}
                        {badgeType && (
                          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider shrink-0">
                            {badgeType}
                          </span>
                        )}
                        {/* Nome da ação */}
                        <span className="text-xs text-slate-500 truncate">
                          {item.shortname || item.longname}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Ativo Selecionado em destaque quando escolhido (barra de pesquisa oculta) */
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Ativo selecionado
            </label>
            <div className="flex items-center justify-between p-3.5 bg-blue-50/70 rounded-2xl border border-blue-100 shadow-xs">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <span className="font-black text-base text-blue-950 tracking-tight shrink-0">
                  {selectedAsset.symbol}
                </span>
                {selectedAsset.quoteType && (
                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-100/80 px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
                    {getCleanQuoteType(selectedAsset.quoteType)}
                  </span>
                )}
                <span className="text-xs text-blue-700 truncate font-medium">
                  {selectedAsset.shortname || selectedAsset.longname}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearSelected}
                className="p-2 -mr-1 text-slate-400 hover:text-slate-600 active:text-slate-900 active:scale-95 transition-all cursor-pointer rounded-lg hover:bg-blue-100/50 shrink-0"
                aria-label="Remover ou alterar ativo selecionado"
              >
                <X className="w-4 h-4 stroke-[2]" />
              </button>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-rose-50 text-rose-700 text-xs font-semibold rounded-xl border border-rose-100">
            {errorMessage}
          </div>
        )}

        {/* Linhas de Compras (Unidades, Preço da ação, Data) */}
        <div className="flex flex-col gap-4">
          {purchases.map((purchase, index) => (
            <div
              key={purchase.id}
              className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col gap-3 relative"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {purchases.length > 1 ? `Compra #${index + 1}` : 'Detalhes da compra'}
                </span>
                {purchases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePurchase(index)}
                    className="p-1 text-slate-400 hover:text-rose-600 active:scale-90 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 stroke-[1.8]" />
                  </button>
                )}
              </div>

              {/* Unidades (balão para escrever) */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Unidades</label>
                <div className="relative flex items-center bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    placeholder="0"
                    value={purchase.shares}
                    onChange={(e) => handleUpdatePurchase(index, 'shares', e.target.value)}
                    className="w-full py-2.5 bg-transparent border-none text-base font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>

              {/* Preço da ação (balão para escrever) */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Preço da ação</label>
                <div className="relative flex items-center bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all px-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    placeholder="0,00"
                    value={purchase.price}
                    onChange={(e) => handleUpdatePurchase(index, 'price', e.target.value)}
                    className="w-full py-2.5 bg-transparent border-none text-base font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-0"
                  />
                  <span className="text-sm font-bold text-slate-400 select-none pr-1">€</span>
                </div>
              </div>

              {/* Data da compra */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Data</label>
                <input
                  type="date"
                  value={purchase.date}
                  onChange={(e) => handleUpdatePurchase(index, 'date', e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Botões de Ação no fundo da página */}
        <div className="flex flex-col gap-2.5 pt-2">
          {/* Botão Adicionar mais */}
          <button
            type="button"
            onClick={handleAddMore}
            disabled={isSaving}
            className="w-full min-h-[50px] py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 active:scale-98 text-slate-700 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.2]" />
            <span>Adicionar mais</span>
          </button>

          {/* Botão Adicionar ativo */}
          <button
            type="button"
            onClick={handleSaveAsset}
            disabled={isSaving}
            className="w-full min-h-[52px] py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>A gravar no Firestore...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4 stroke-[2.2]" />
                <span>Adicionar ativo</span>
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
