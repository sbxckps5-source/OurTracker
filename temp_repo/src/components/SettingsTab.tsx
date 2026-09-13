import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  RotateCcw,
  Search,
  Check,
  Edit2,
  Trash2,
  Plus,
  DollarSign,
  Globe,
  X,
  ShieldAlert,
  Database,
  CloudDownload,
  Loader2,
  ChevronDown,
  ChevronUp,
  Layers,
  Briefcase,
  ChevronRight,
} from 'lucide-react';
import {
  saveHolding,
  savePortfolioMeta,
  createCloudBackup,
  fetchCloudBackups,
  restoreCloudBackup,
  fetchLiveQuotes,
  BackupDoc,
} from '../services/portfolioService';
import { db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { searchYahoo } from '../services/yahooResolver';
import { PdfPortfolioPosition, PdfDepositItem, PdfParseResponse } from '../types';
import {
  ClientPortfolioData,
  parseExcelPortfolio,
  ClientLoadedPosition,
} from '../utils/clientPortfolioLoader';
import { fetchYahooQuote, convertTickerToYahoo } from '../utils/yahooClient';
import { ClientPortfolioView } from './ClientPortfolioView';
import { ManualAddTransaction } from './ManualAddTransaction';
import { EditPortfolio } from './EditPortfolio';

interface SettingsTabProps {
  onSyncComplete?: () => void;
}

const SUPPORTED_CURRENCIES = [
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'USD', symbol: '$', name: 'Dólar Americano' },
  { code: 'GBP', symbol: '£', name: 'Libra Esterlina' },
  { code: 'CHF', symbol: 'CHF', name: 'Franco Suíço' },
];

export const SettingsTab: React.FC<SettingsTabProps> = ({ onSyncComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isManualEntry, setIsManualEntry] = useState<boolean>(false);
  const [showEntryTypeMenu, setShowEntryTypeMenu] = useState<boolean>(false);
  const [showDepositMenu, setShowDepositMenu] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [isEditPortfolio, setIsEditPortfolio] = useState<boolean>(false);

  // Client-side Excel portfolio state
  const [clientPortfolioData, setClientPortfolioData] = useState<ClientPortfolioData | null>(null);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState<boolean>(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  // Review & Edit state
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [activeReviewTab, setActiveReviewTab] = useState<'positions' | 'deposits' | 'settings'>('positions');
  const [detectedCurrency, setDetectedCurrency] = useState<string>('EUR');
  const [currencySymbol, setCurrencySymbol] = useState<string>('€');
  const [positions, setPositions] = useState<PdfPortfolioPosition[]>([]);
  const [deposits, setDeposits] = useState<PdfDepositItem[]>([]);
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [showDeposits, setShowDeposits] = useState<boolean>(false);
  const [expandedLots, setExpandedLots] = useState<Record<string, boolean>>({});

  // Fetch live quotes whenever reviewing positions to calculate P&L accurately
  useEffect(() => {
    if (isReviewing && positions.length > 0) {
      const tickersToFetch = positions
        .map((p) => p.ticker)
        .filter((t) => t && t.trim().length > 0);

      if (tickersToFetch.length > 0) {
        setIsLoadingQuotes(true);
        fetchLiveQuotes(tickersToFetch)
          .then((quotes) => {
            if (quotes) {
              setPositions((prev) =>
                prev.map((p) => {
                  if (!p.ticker) return p;
                  const normKey = convertTickerToYahoo(p.ticker).toUpperCase();
                  const q = quotes[normKey] || quotes[p.ticker.toUpperCase()];
                  if (q && q.price && q.price > 0) {
                    const currPrice = Number(q.price);
                    const openPrice = p.openPrice ?? (p.volume > 0 ? p.value / p.volume : 0);
                    const calculatedProfit = Number(((currPrice - openPrice) * p.volume).toFixed(2));
                    return {
                      ...p,
                      currentPrice: currPrice,
                      profit: calculatedProfit,
                    };
                  }
                  return p;
                })
              );
            }
          })
          .catch((err) => console.warn('Quotes fetch error:', err))
          .finally(() => setIsLoadingQuotes(false));
      }
    }
  }, [isReviewing]);

  const toggleExpandLots = (id: string) => {
    setExpandedLots((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleUpdateLot = (posId: string, lotIdx: number, field: 'date' | 'shares' | 'price', value: any) => {
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== posId) return pos;

        const currentPurchases = pos.purchases && pos.purchases.length > 0
          ? [...pos.purchases]
          : [
              {
                id: `p-${pos.id}`,
                date: pos.openDate ? new Date(pos.openDate).getTime() : Date.now(),
                shares: pos.volume,
                price: pos.openPrice || 0,
                priceEur: pos.openPrice || 0,
              },
            ];

        if (!currentPurchases[lotIdx]) return pos;

        const updatedLot = { ...currentPurchases[lotIdx], [field]: value };
        if (field === 'price') {
          updatedLot.priceEur = value;
        }
        currentPurchases[lotIdx] = updatedLot;

        // Recalculate position totals
        const totalShares = currentPurchases.reduce((acc, l) => acc + (Number(l.shares) || 0), 0);
        const totalCost = currentPurchases.reduce(
          (acc, l) => acc + (Number(l.shares) || 0) * (Number(l.price ?? l.priceEur) || 0),
          0
        );
        const newAvgPrice = totalShares > 0 ? totalCost / totalShares : pos.openPrice || 0;
        const currP = pos.currentPrice ?? newAvgPrice;
        const calcProfit = Number(((currP - newAvgPrice) * totalShares).toFixed(2));

        return {
          ...pos,
          purchases: currentPurchases,
          volume: Number(totalShares.toFixed(4)),
          openPrice: Number(newAvgPrice.toFixed(4)),
          value: Number((totalShares * newAvgPrice).toFixed(2)),
          profit: calcProfit,
        };
      })
    );
  };

  const handleAddLot = (posId: string) => {
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== posId) return pos;

        const currentPurchases = pos.purchases && pos.purchases.length > 0
          ? [...pos.purchases]
          : [
              {
                id: `p-${pos.id}`,
                date: pos.openDate ? new Date(pos.openDate).getTime() : Date.now(),
                shares: pos.volume,
                price: pos.openPrice || 0,
                priceEur: pos.openPrice || 0,
              },
            ];

        currentPurchases.push({
          id: `lot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          date: Date.now(),
          shares: 1,
          price: pos.openPrice || 10,
          priceEur: pos.openPrice || 10,
        });

        const totalShares = currentPurchases.reduce((acc, l) => acc + (Number(l.shares) || 0), 0);
        const totalCost = currentPurchases.reduce(
          (acc, l) => acc + (Number(l.shares) || 0) * (Number(l.price ?? l.priceEur) || 0),
          0
        );
        const newAvgPrice = totalShares > 0 ? totalCost / totalShares : pos.openPrice || 0;
        const currP = pos.currentPrice ?? newAvgPrice;
        const calcProfit = Number(((currP - newAvgPrice) * totalShares).toFixed(2));

        return {
          ...pos,
          purchases: currentPurchases,
          volume: Number(totalShares.toFixed(4)),
          openPrice: Number(newAvgPrice.toFixed(4)),
          value: Number((totalShares * newAvgPrice).toFixed(2)),
          profit: calcProfit,
        };
      })
    );
  };

  const handleRemoveLot = (posId: string, lotIdx: number) => {
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== posId) return pos;
        if (!pos.purchases) return pos;

        const currentPurchases = pos.purchases.filter((_, idx) => idx !== lotIdx);

        const totalShares = currentPurchases.reduce((acc, l) => acc + (Number(l.shares) || 0), 0);
        const totalCost = currentPurchases.reduce(
          (acc, l) => acc + (Number(l.shares) || 0) * (Number(l.price ?? l.priceEur) || 0),
          0
        );
        const newAvgPrice = totalShares > 0 ? totalCost / totalShares : pos.openPrice || 0;
        const currP = pos.currentPrice ?? newAvgPrice;
        const calcProfit = Number(((currP - newAvgPrice) * totalShares).toFixed(2));

        return {
          ...pos,
          purchases: currentPurchases,
          volume: Number(totalShares.toFixed(4)),
          openPrice: Number(newAvgPrice.toFixed(4)),
          value: Number((totalShares * newAvgPrice).toFixed(2)),
          profit: calcProfit,
        };
      })
    );
  };

  // FX multi-API state
  const [fxRateToEur, setFxRateToEur] = useState<number>(1.0);
  const [fxProvider, setFxProvider] = useState<string>('');
  const [isLoadingFx, setIsLoadingFx] = useState<boolean>(false);
  const [isConvertedToEur, setIsConvertedToEur] = useState<boolean>(false);

  // Saving state
  const [isSavingToDb, setIsSavingToDb] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Backup modal state
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [backupsList, setBackupsList] = useState<BackupDoc[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState<boolean>(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
  const [backupNotification, setBackupNotification] = useState<string | null>(null);

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const bks = await fetchCloudBackups('main');
      setBackupsList(bks);
    } catch (err) {
      console.error('Error fetching cloud backups:', err);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleOpenBackupModal = () => {
    setIsBackupModalOpen(true);
    setBackupNotification(null);
    loadBackups();
  };

  const handleCreateNewBackup = async () => {
    setIsCreatingBackup(true);
    setBackupNotification(null);
    try {
      await createCloudBackup('main');
      setBackupNotification('Backup criado com sucesso na nuvem!');
      await loadBackups();
    } catch (err) {
      console.error('Error creating cloud backup:', err);
      setBackupNotification('Erro ao criar backup na nuvem.');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackupItem = async (backup: BackupDoc) => {
    setRestoringBackupId(backup.id);
    setBackupNotification(null);
    try {
      await restoreCloudBackup(backup, 'main');
      setBackupNotification(`Backup de ${backup.formattedDate} restaurado com sucesso!`);
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (err) {
      console.error('Error restoring backup:', err);
      setBackupNotification('Erro ao restaurar o backup.');
    } finally {
      setRestoringBackupId(null);
    }
  };

  // Modal for Yahoo Search ticker
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load FX rate whenever currency changes
  useEffect(() => {
    if (detectedCurrency === 'EUR') {
      setFxRateToEur(1.0);
      setFxProvider('Direto (1:1)');
      return;
    }

    const fetchLiveFx = async () => {
      setIsLoadingFx(true);
      try {
        const res = await fetch(`/api/fx/convert/rate?from=${detectedCurrency}&to=EUR`);
        if (res.ok) {
          const data = await res.json();
          setFxRateToEur(data.rate || 1.0);
          setFxProvider(data.provider || 'Multi-API FX');
        }
      } catch (err) {
        console.warn('Could not load FX rate:', err);
      } finally {
        setIsLoadingFx(false);
      }
    };

    fetchLiveFx();
  }, [detectedCurrency]);

  const handleExcelFile = async (uploadedFile: File) => {
    setErrorMessage(null);
    setIsProcessing(true);
    setStatusMessage('A ler o ficheiro Excel...');

    try {
      const reader = new FileReader();
      const bufferPromise = new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = (e) => reject(e);
        reader.readAsArrayBuffer(uploadedFile);
      });

      const buffer = await bufferPromise;

      setStatusMessage('A processar depósitos e posições abertas...');
      const portfolioData = await parseExcelPortfolio(buffer);

      // Map Excel positions into editable preview positions
      const formattedPositions: PdfPortfolioPosition[] = portfolioData.positions.map((pos) => {
        const openP = pos.openPrice || (pos.volume > 0 ? pos.value / pos.volume : 0);
        const firstBuyDate =
          pos.purchases && pos.purchases.length > 0 && pos.purchases[0].date
            ? new Date(pos.purchases[0].date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

        return {
          id: pos.id || `pos-${Math.random().toString(36).substring(2, 9)}`,
          name: pos.name || pos.ticker || 'Ativo',
          ticker: (pos.ticker || pos.yahooTicker || '').toUpperCase(),
          category: pos.category || 'Ação',
          volume: pos.volume || 1,
          value: Number((pos.value || pos.volume * openP).toFixed(2)),
          profit: Number((pos.profitEur || 0).toFixed(2)),
          openPrice: openP,
          currentPrice: pos.currentPrice ?? undefined,
          openDate: firstBuyDate,
          purchases: pos.purchases && pos.purchases.length > 0 ? pos.purchases : undefined,
        };
      });

      // Map deposits into editable deposits list
      const formattedDeposits: PdfDepositItem[] =
        portfolioData.deposits && portfolioData.deposits.length > 0
          ? portfolioData.deposits.map((d) => ({
              id: d.id,
              date: d.date,
              amount: d.amount,
              comment: d.comment || 'Depósito',
            }))
          : portfolioData.totalDeposited > 0
          ? [
              {
                id: `dep-${Date.now()}`,
                date: `${String(new Date().getDate()).padStart(2, '0')}/${String(
                  new Date().getMonth() + 1
                ).padStart(2, '0')}/${new Date().getFullYear()}`,
                amount: Number(portfolioData.totalDeposited.toFixed(2)),
                comment: 'Depósito inicial (Excel)',
              },
            ]
          : [];

      setPositions(formattedPositions);
      setDeposits(formattedDeposits);
      setFile(uploadedFile);
      setDetectedCurrency('EUR');
      setCurrencySymbol('€');
      setIsReviewing(true);
      setClientPortfolioData(null);
    } catch (err: any) {
      console.error('Erro ao processar ficheiro Excel:', err);
      setErrorMessage(
        err?.message || 'Erro ao processar o ficheiro Excel. Confirma que contém as folhas necessárias.'
      );
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
      setIsLoadingQuotes(false);
    }
  };

  const handleExcelInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      handleExcelFile(selected);
    }
  };

  const handleFile = async (uploadedFile: File) => {
    setErrorMessage(null);
    setSaveSuccess(false);

    const isExcel = uploadedFile.name.toLowerCase().endsWith('.xlsx');
    const isPdf = uploadedFile.name.toLowerCase().endsWith('.pdf') || uploadedFile.type === 'application/pdf';

    if (isExcel) {
      await handleExcelFile(uploadedFile);
      return;
    }

    if (!isPdf) {
      setErrorMessage(
        'Apenas são aceites ficheiros em formato PDF (.pdf) ou Excel (.xlsx). Carregamentos através do Google Drive não são permitidos.'
      );
      return;
    }

    setFile(uploadedFile);
    setIsProcessing(true);
    setStatusMessage('A carregar e a analisar o PDF do teu portfólio...');

    try {
      const reader = new FileReader();

      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(uploadedFile);
      });

      const base64 = await base64Promise;

      setStatusMessage('A extrair moeda, depósitos e posições do documento...');
      const response = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64 }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Erro de análise HTTP ${response.status}`);
      }

      const data: PdfParseResponse = await response.json();

      if (!data.openPositions || data.openPositions.length === 0) {
        // If no positions detected directly, give user an empty review template with detected currency
        setPositions([
          {
            id: `pos-${Date.now()}`,
            name: 'Ativo 1',
            ticker: '',
            category: 'ETF',
            volume: 1,
            value: 100,
            profit: 0,
          },
        ]);
      } else {
        setPositions(data.openPositions);
      }

      setDeposits(data.deposits || []);
      setAccountNumber(data.account || '');
      setDetectedCurrency(data.currency || 'EUR');
      setCurrencySymbol(data.currencySymbol || '€');
      setIsReviewing(true);
    } catch (err: any) {
      console.error('Error parsing PDF:', err);
      setErrorMessage(
        err?.message ||
          'Erro ao ler o ficheiro PDF. Por favor confirma se é um extrato ou relatório de portfólio válido.'
      );
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      handleFile(selected);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    // Check if dragging files from Google Drive / URL
    const items = e.dataTransfer.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'string' && items[i].type.includes('uri-list')) {
          setErrorMessage('Carregamentos a partir do Google Drive não são permitidos. Por favor faz o download do PDF para o teu dispositivo e carrega-o diretamente.');
          return;
        }
      }
    }

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Editing position handlers
  const handleUpdatePosition = (id: string, field: keyof PdfPortfolioPosition, value: any) => {
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id === id) {
          const updated = { ...pos, [field]: value };

          if (field === 'volume' || field === 'openPrice') {
            const vol = field === 'volume' ? Number(value) : (pos.volume || 0);
            const openP = field === 'openPrice' ? Number(value) : (pos.openPrice || 0);
            const currPriceVal = pos.currentPrice ?? openP;
            updated.profit = Number(((currPriceVal - openP) * vol).toFixed(2));
            updated.value = Number((vol * openP).toFixed(2));

            if (updated.purchases && updated.purchases.length === 1) {
              updated.purchases = [
                {
                  ...updated.purchases[0],
                  shares: vol,
                  price: openP,
                  priceEur: openP,
                }
              ];
            } else if (!updated.purchases || updated.purchases.length === 0) {
              updated.purchases = [
                {
                  id: `p-${pos.id}-0`,
                  date: pos.openDate ? new Date(pos.openDate).getTime() : Date.now(),
                  shares: vol,
                  price: openP,
                  priceEur: openP,
                }
              ];
            }
          }
          return updated;
        }
        return pos;
      })
    );
  };

  const handleRemovePosition = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  const handleAddPosition = () => {
    const newPos: PdfPortfolioPosition = {
      id: `pos-${Date.now()}`,
      name: `Novo Ativo ${positions.length + 1}`,
      ticker: '',
      category: 'Ação',
      volume: 1,
      value: 0,
      profit: 0,
    };
    setPositions((prev) => [...prev, newPos]);
  };

  // Deposit handlers
  const handleUpdateDeposit = (id: string, field: keyof PdfDepositItem, value: any) => {
    setDeposits((prev) =>
      prev.map((dep) => {
        if (dep.id === id) {
          return { ...dep, [field]: value };
        }
        return dep;
      })
    );
  };

  const handleRemoveDeposit = (id: string) => {
    setDeposits((prev) => prev.filter((d) => d.id !== id));
  };

  const handleAddDeposit = () => {
    const today = new Date();
    const formatted = `${String(today.getDate()).padStart(2, '0')}/${String(
      today.getMonth() + 1
    ).padStart(2, '0')}/${today.getFullYear()}`;

    setDeposits((prev) => [
      ...prev,
      {
        id: `dep-${Date.now()}`,
        date: formatted,
        amount: 100,
      },
    ]);
  };

  // Convert all values to EUR using Multi-API FX rate
  const handleConvertAllToEur = () => {
    if (detectedCurrency === 'EUR' || fxRateToEur <= 0) return;

    setPositions((prev) =>
      prev.map((pos) => ({
        ...pos,
        value: Number((pos.value * fxRateToEur).toFixed(2)),
        profit: Number((pos.profit * fxRateToEur).toFixed(2)),
      }))
    );

    setDeposits((prev) =>
      prev.map((dep) => ({
        ...dep,
        amount: Number((dep.amount * fxRateToEur).toFixed(2)),
      }))
    );

    setDetectedCurrency('EUR');
    setCurrencySymbol('€');
    setIsConvertedToEur(true);
  };

  // Currency change override
  const handleCurrencyChange = (newCode: string) => {
    const found = SUPPORTED_CURRENCIES.find((c) => c.code === newCode);
    setDetectedCurrency(newCode);
    if (found) {
      setCurrencySymbol(found.symbol);
    }
  };

  // Search ticker modal
  const handleOpenSearchModal = (pos: PdfPortfolioPosition) => {
    setEditingPosId(pos.id);
    setSearchQuery(pos.ticker || pos.name);
    setSearchResults([]);
  };

  const handlePerformSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await searchYahoo(searchQuery);
      setSearchResults(results);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectTicker = (symbol: string, name?: string) => {
    if (!editingPosId) return;
    setPositions((prev) =>
      prev.map((p) => {
        if (p.id === editingPosId) {
          return {
            ...p,
            ticker: symbol.toUpperCase(),
            name: name || p.name,
          };
        }
        return p;
      })
    );
    setEditingPosId(null);
  };

  // Save to Firestore and finish
  const handleAcceptAndSave = async () => {
    if (positions.length === 0) {
      setErrorMessage('Por favor adiciona pelo menos uma posição antes de aceitar.');
      return;
    }

    setIsSavingToDb(true);
    setErrorMessage(null);

    try {
      // Save each confirmed holding with purchase date record
      for (const pos of positions) {
        const tickerToSave = pos.ticker.trim()
          ? pos.ticker.trim().toUpperCase()
          : `ATIVO_${pos.name.replace(/\s+/g, '_').toUpperCase()}`;

        const posDate = pos.openDate ? new Date(pos.openDate).getTime() : Date.now();
        const unitPrice = pos.openPrice ?? (pos.volume > 0 ? pos.value / pos.volume : 0);

        const purchaseRecord =
          pos.purchases && pos.purchases.length > 0
            ? pos.purchases.map((p, pIdx) => ({
                id: p.id || `p-${pos.id}-${pIdx}`,
                date: typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || posDate || Date.now()),
                shares: Number(p.shares || 0),
                price: Number(p.price ?? unitPrice),
                priceEur: Number(p.priceEur ?? p.price ?? unitPrice),
              }))
            : [
                {
                  id: `p-${pos.id}`,
                  date: isNaN(posDate) ? Date.now() : posDate,
                  shares: Number(pos.volume || 1),
                  price: Number(unitPrice || 0),
                  priceEur: Number(unitPrice || 0),
                },
              ];

        await saveHolding('main', tickerToSave, Number(pos.volume || 1), undefined, purchaseRecord);
      }

      // Save metadata (currency, deposits, etc.)
      const totalDeposited = deposits.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
      await savePortfolioMeta('main', {
        currency: detectedCurrency,
        totalDeposited: Number(totalDeposited.toFixed(2)),
        account: accountNumber,
        deposits: deposits.map((d) => ({ date: d.date, amount: Number(d.amount) || 0 })),
      });

      // Automatically store cloud backup of the newly saved portfolio
      try {
        await createCloudBackup('main');
      } catch (bkErr) {
        console.warn('Auto backup notice:', bkErr);
      }

      setSaveSuccess(true);
      if (onSyncComplete) {
        setTimeout(() => {
          onSyncComplete();
        }, 1200);
      }
    } catch (err: any) {
      console.error('Error saving portfolio:', err);
      setErrorMessage('Erro ao guardar as posições na base de dados. Tenta novamente.');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setClientPortfolioData(null);
    setIsReviewing(false);
    setPositions([]);
    setDeposits([]);
    setErrorMessage(null);
    setSaveSuccess(false);
    setIsConvertedToEur(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (excelFileInputRef.current) {
      excelFileInputRef.current.value = '';
    }
  };

  // Calculations for summary stats
  const totalValueCalc = Number(
    positions.reduce((acc, p) => acc + (Number(p.value) || 0), 0).toFixed(2)
  );
  const totalProfitCalc = Number(
    positions.reduce((acc, p) => acc + (Number(p.profit) || 0), 0).toFixed(2)
  );
  const totalDepositedCalc = Number(
    deposits.reduce((acc, d) => acc + (Number(d.amount) || 0), 0).toFixed(2)
  );

  return (
    <div className="w-full min-h-full px-4 pt-5 pb-48 flex flex-col items-center">
      {/* Simplified Header with Backup Button */}
      <div className="w-full flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Definições</h1>
        <button
          type="button"
          onClick={handleOpenBackupModal}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
        >
          <Database className="w-4 h-4" />
          <span>Backup</span>
        </button>
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="w-full mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start gap-2.5 text-xs shadow-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">Aviso</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-800 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Success banner */}
      {saveSuccess && (
        <div className="w-full mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 text-xs shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div>
            <div className="font-bold text-sm">Portfólio Guardado com Sucesso!</div>
            <div>Todas as posições foram adicionadas à tua carteira. A redirecionar...</div>
          </div>
        </div>
      )}

      {/* Step 1: Upload View (Simplified Button) */}
      {!isReviewing && !clientPortfolioData && !isManualEntry && !isEditPortfolio && (
        <div className="w-full flex flex-col items-center justify-center pt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileInputChange}
            className="hidden"
            id="file-input-unified"
          />

          <button
            type="button"
            id="portfolio-upload-button"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className={`w-full py-4 px-6 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer disabled:opacity-75 ${
              isDragOver ? 'ring-4 ring-rose-300 scale-[0.99]' : ''
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{statusMessage || 'A processar...'}</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-5 h-5" />
                <span>Carregar Portfolio</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowEntryTypeMenu(true)}
            className="w-full mt-3 py-4 px-6 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 active:scale-98 text-slate-700 font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer"
          >
            <Edit2 className="w-5 h-5" />
            <span>Adicionar Manualmente</span>
          </button>
          
          <button
            type="button"
            onClick={() => setIsEditPortfolio(true)}
            className="w-full mt-3 py-4 px-6 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 active:scale-98 text-slate-700 font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer"
          >
            <Layers className="w-5 h-5" />
            <span>Editar Portfólio</span>
          </button>
        </div>
      )}

      {showEntryTypeMenu && (
        <div className="fixed inset-0 z-[110] bg-white flex flex-col animate-in fade-in">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Tipo de Adição</h2>
            <button 
              onClick={() => setShowEntryTypeMenu(false)} 
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 flex flex-col gap-3 flex-1 overflow-y-auto">
             <button 
               onClick={() => { setShowEntryTypeMenu(false); setShowDepositMenu(true); }} 
               className="w-full p-4 bg-slate-50 border border-slate-100 hover:border-slate-200 active:bg-slate-100 rounded-2xl flex items-center justify-between cursor-pointer transition-colors"
             >
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-xs text-blue-600 border border-slate-100">
                     <DollarSign className="w-6 h-6"/>
                   </div>
                   <div className="flex flex-col items-start">
                     <span className="font-bold text-base text-slate-900">Depósito</span>
                     <span className="text-sm text-slate-500 font-medium">Adicionar saldo</span>
                   </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
             </button>

             <button 
               onClick={() => { setShowEntryTypeMenu(false); setIsManualEntry(true); }} 
               className="w-full p-4 bg-slate-50 border border-slate-100 hover:border-slate-200 active:bg-slate-100 rounded-2xl flex items-center justify-between cursor-pointer transition-colors"
             >
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-xs text-emerald-600 border border-slate-100">
                     <Briefcase className="w-6 h-6"/>
                   </div>
                   <div className="flex flex-col items-start">
                     <span className="font-bold text-base text-slate-900">Posição</span>
                     <span className="text-sm text-slate-500 font-medium">Adicionar ativo financeiro</span>
                   </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
             </button>
          </div>
        </div>
      )}

      {showDepositMenu && (
        <div className="fixed inset-0 z-[110] flex flex-col justify-end bg-black/40">
          <div className="w-full bg-white rounded-t-3xl p-6 flex flex-col gap-4 animate-in slide-in-from-bottom pb-10">
             <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-lg text-slate-900">Novo Depósito</span>
                <button onClick={() => { setShowDepositMenu(false); setDepositAmount(''); }} className="p-2 -mr-2 text-slate-400 hover:text-slate-900 cursor-pointer"><X className="w-6 h-6"/></button>
             </div>
             
             <div className="flex flex-col gap-1.5">
               <label className="text-xs font-bold text-slate-500 uppercase">Montante</label>
               <div className="relative flex items-center bg-slate-50 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-slate-200 border border-slate-100 p-2">
                 <input
                   type="number"
                   value={depositAmount}
                   onChange={(e) => setDepositAmount(e.target.value)}
                   autoFocus
                   placeholder="0.00"
                   className="w-full p-4 bg-transparent border-0 text-3xl font-bold text-slate-900 placeholder:text-slate-300 focus:ring-0 outline-none"
                 />
                 <div className="pr-6 flex items-center text-slate-400 font-bold text-3xl">
                   €
                 </div>
               </div>
             </div>

             <div className="flex flex-col gap-1.5">
               <label className="text-xs font-bold text-slate-500 uppercase">Data do Depósito</label>
               <input
                 type="date"
                 defaultValue={new Date().toISOString().split('T')[0]}
                 id="deposit-date-input"
                 className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-100 text-slate-900 font-semibold text-base outline-none"
               />
             </div>

             <button 
               onClick={async () => {
                 const dateInput = (document.getElementById('deposit-date-input') as HTMLInputElement)?.value;
                 const dateVal = dateInput ? new Date(dateInput).toISOString() : new Date().toISOString();
                 const amountVal = parseFloat(depositAmount) || 0;
                 try {
                   const portfolioRef = doc(db, 'portfolios', 'main');
                   const snap = await getDoc(portfolioRef);
                   let existingDeposits = [];
                   let currentTotal = 0;
                   if (snap.exists()) {
                     const data = snap.data();
                     existingDeposits = data.deposits || [];
                     currentTotal = data.totalDeposited || 0;
                   }
                   const newDeposit = {
                     amount: amountVal,
                     date: dateVal
                   };
                   const updatedDeposits = [newDeposit, ...existingDeposits];
                   const newTotal = currentTotal + amountVal;
                   
                   await setDoc(portfolioRef, {
                     deposits: updatedDeposits,
                     totalDeposited: newTotal,
                     updatedAt: Date.now()
                   }, { merge: true });
                 } catch (e) {
                   console.error(e);
                 }
                 setShowDepositMenu(false);
                 setDepositAmount('');
                 if (onSyncComplete) onSyncComplete();
               }}
               disabled={!depositAmount || isNaN(parseFloat(depositAmount)) || parseFloat(depositAmount) <= 0}
               className="w-full py-4 mt-2 bg-black hover:bg-slate-900 active:bg-slate-800 text-white rounded-2xl font-bold text-base transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
             >
               Confirmar Depósito
             </button>
          </div>
        </div>
      )}

      {/* Manual Entry View */}
      {isManualEntry && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col">
          <ManualAddTransaction 
            onBack={() => setIsManualEntry(false)} 
            onSuccess={() => {
              setIsManualEntry(false);
              if (onSyncComplete) onSyncComplete();
            }} 
          />
        </div>
      )}

      {/* Edit Portfolio View */}
      {isEditPortfolio && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col">
          <EditPortfolio 
            onBack={() => setIsEditPortfolio(false)} 
          />
        </div>
      )}

      {/* Step 1.5: Client-Side Excel Portfolio View */}
      {clientPortfolioData && (
        <ClientPortfolioView
          data={clientPortfolioData}
          isLoadingQuotes={isLoadingQuotes}
          onUploadCloudSuccess={onSyncComplete}
          onUploadNew={() => {
            setClientPortfolioData(null);
            setTimeout(() => {
              excelFileInputRef.current?.click();
            }, 50);
          }}
        />
      )}

      {/* Step 2: Review and Edit View (Before Accepting) */}
      {isReviewing && (
        <div className="w-full flex flex-col gap-3 pb-24">
          {/* File bar and reset button */}
          <div className="w-full flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="text-xs font-bold text-slate-900 block truncate">
                  {file?.name || 'documento_portfolio.pdf'}
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  Conta: {accountNumber || 'Detetada'} • {positions.length} ativos
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Trocar</span>
            </button>
          </div>

          {/* Quick Summary Cards */}
          <div className="w-full grid grid-cols-3 gap-2">
            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                Depositado
              </span>
              <div className="text-sm font-black text-slate-900 mt-1 truncate">
                {currencySymbol}
                {totalDepositedCalc.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                Em Carteira
              </span>
              <div className="text-sm font-black text-emerald-600 mt-1 truncate">
                {currencySymbol}
                {totalValueCalc.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                Lucro / P&L
              </span>
              <div
                className={`text-sm font-black mt-1 truncate flex items-center gap-0.5 ${
                  totalProfitCalc >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                <span>
                  {totalProfitCalc >= 0 ? '+' : ''}
                  {currencySymbol}
                  {totalProfitCalc.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* iPhone-Style Segmented Navigation Bar (Touch-Friendly 44px targets) */}
          <div className="w-full bg-slate-200/80 p-1 rounded-2xl flex items-center justify-between text-xs font-bold gap-1 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveReviewTab('positions')}
              className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeReviewTab === 'positions'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Posições ({positions.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveReviewTab('deposits')}
              className={`flex-1 min-h-[44px] py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeReviewTab === 'deposits'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Depósitos ({deposits.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveReviewTab('settings')}
              className={`min-h-[44px] py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeReviewTab === 'settings'
                  ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4 text-emerald-600" />
              <span>Moeda</span>
            </button>
          </div>

          {/* TAB 1: POSITIONS EDITING */}
          {activeReviewTab === 'positions' && (
            <div className="w-full flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-700">Editar Posições e Ações</span>
                <button
                  type="button"
                  onClick={handleAddPosition}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova Posição</span>
                </button>
              </div>

              {positions.map((pos, index) => {
                const avgOpenPrice = pos.openPrice ?? (pos.volume > 0 ? pos.value / pos.volume : 0);
                const currentPriceVal = pos.currentPrice ?? avgOpenPrice;
                const calcProfit = (currentPriceVal - avgOpenPrice) * pos.volume;
                const calcProfitPercent = avgOpenPrice > 0 ? ((currentPriceVal - avgOpenPrice) / avgOpenPrice) * 100 : 0;
                const lotsCount = pos.purchases?.length || 1;
                const isExpanded = !!expandedLots[pos.id];

                return (
                  <div
                    key={pos.id}
                    className="w-full p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-3"
                  >
                    {/* Header: Index, Ticker, Name, Category & Delete */}
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 text-xs font-black flex items-center justify-center flex-shrink-0">
                        {index + 1}
                      </div>

                      <div className="flex items-center gap-1 w-28 sm:w-36">
                        <input
                          type="text"
                          value={pos.ticker}
                          onChange={(e) =>
                            handleUpdatePosition(pos.id, 'ticker', e.target.value.toUpperCase())
                          }
                          placeholder="TICKER"
                          className="w-full min-h-[38px] px-2.5 py-1 font-mono font-bold text-xs uppercase bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleOpenSearchModal(pos)}
                          title="Procurar ticker no Yahoo"
                          className="min-h-[38px] w-8 flex items-center justify-center text-slate-500 hover:text-blue-600 rounded-xl bg-slate-50 border border-slate-200"
                        >
                          <Search className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={pos.name}
                        onChange={(e) => handleUpdatePosition(pos.id, 'name', e.target.value)}
                        placeholder="Nome do Ativo"
                        className="flex-1 min-h-[38px] px-3 py-1 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none truncate"
                      />

                      <div className="w-32">
                        <input
                          type="date"
                          value={pos.openDate ? new Date(pos.openDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                          onChange={(e) => handleUpdatePosition(pos.id, 'openDate', new Date(e.target.value).getTime())}
                          className="w-full min-h-[38px] px-2 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800"
                          title="Data da posição"
                        />
                      </div>

                      <select
                        value={pos.category || 'Ação'}
                        onChange={(e) => handleUpdatePosition(pos.id, 'category', e.target.value)}
                        className="hidden sm:block min-h-[38px] px-2 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 outline-none"
                      >
                        <option value="ETF">ETF</option>
                        <option value="Ação">Ação</option>
                        <option value="Cripto">Cripto</option>
                        <option value="Obrigação">Obrigação</option>
                        <option value="Outro">Outro</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemovePosition(pos.id)}
                        className="min-h-[38px] w-8 flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 transition-colors"
                        title="Eliminar ativo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Consolidated Top-Level Row: Qtd Total, Preço Médio, Preço Atual, P&L */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Ações (Total)
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={pos.volume}
                          onChange={(e) =>
                            handleUpdatePosition(pos.id, 'volume', parseFloat(e.target.value) || 0)
                          }
                          className="w-full min-h-[38px] px-2.5 py-1 text-xs font-extrabold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Preço Médio ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={avgOpenPrice}
                          onChange={(e) => {
                            const pPrice = parseFloat(e.target.value) || 0;
                            handleUpdatePosition(pos.id, 'openPrice', pPrice);
                            handleUpdatePosition(pos.id, 'value', Number((pPrice * pos.volume).toFixed(2)));
                          }}
                          className="w-full min-h-[38px] px-2.5 py-1 text-xs font-extrabold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Preço Atual ({currencySymbol})
                        </label>
                        <div className="w-full min-h-[38px] px-2.5 py-1 text-xs font-bold bg-slate-100/90 border border-slate-200 rounded-xl text-slate-800 flex items-center">
                          {pos.currentPrice ? `${currencySymbol}${pos.currentPrice.toFixed(2)}` : 'A carregar...'}
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Lucro / Prejuízo (P&L)
                        </label>
                        <div
                          className={`w-full min-h-[38px] px-2.5 py-1 text-xs font-extrabold rounded-xl flex items-center justify-between border ${
                            calcProfit >= 0
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          <span>{calcProfit >= 0 ? '+' : ''}{currencySymbol}{calcProfit.toFixed(2)}</span>
                          <span className="text-[10px] font-bold">({calcProfitPercent >= 0 ? '+' : ''}{calcProfitPercent.toFixed(1)}%)</span>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Individual Purchase Lots */}
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => toggleExpandLots(pos.id)}
                        className="w-full min-h-[34px] px-3 py-1 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-blue-600" />
                          <span>Ver Compras / Posições ({lotsCount} {lotsCount === 1 ? 'lote' : 'lotes'})</span>
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                      </button>

                      {isExpanded && (
                        <div className="mt-3 flex flex-col gap-2 p-3 bg-slate-50/80 rounded-xl border border-slate-200">
                          <div className="flex items-center justify-between px-1 mb-1">
                            <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                              Lotes de Compra Indivíduais
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAddLot(pos.id)}
                              className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Adicionar Compra</span>
                            </button>
                          </div>

                          {(!pos.purchases || pos.purchases.length === 0) ? (
                            <div className="p-3 bg-white rounded-lg border border-slate-200 text-slate-500 text-xs text-center font-medium">
                              Nenhum lote individual registado. Clique em "Adicionar Compra" para registar uma data específica.
                            </div>
                          ) : (
                            pos.purchases.map((lot, lotIdx) => (
                              <div
                                key={lot.id || lotIdx}
                                className="grid grid-cols-12 gap-2 items-center p-2 bg-white rounded-lg border border-slate-200 shadow-2xs text-xs"
                              >
                                {/* Date */}
                                <div className="col-span-5 sm:col-span-4">
                                  <label className="text-[9px] font-bold text-slate-400 block mb-0.5 uppercase">
                                    Data
                                  </label>
                                  <input
                                    type="date"
                                    value={
                                      lot.date
                                        ? new Date(lot.date).toISOString().split('T')[0]
                                        : new Date().toISOString().split('T')[0]
                                    }
                                    onChange={(e) =>
                                      handleUpdateLot(pos.id, lotIdx, 'date', new Date(e.target.value).getTime())
                                    }
                                    className="w-full px-2 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                                  />
                                </div>

                                {/* Qtd */}
                                <div className="col-span-3 sm:col-span-3">
                                  <label className="text-[9px] font-bold text-slate-400 block mb-0.5 uppercase">
                                    Qtd.
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    value={lot.shares}
                                    onChange={(e) =>
                                      handleUpdateLot(pos.id, lotIdx, 'shares', parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full px-2 py-1 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                                  />
                                </div>

                                {/* Preço € */}
                                <div className="col-span-3 sm:col-span-4">
                                  <label className="text-[9px] font-bold text-slate-400 block mb-0.5 uppercase">
                                    Preço ({currencySymbol})
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    value={lot.price ?? lot.priceEur ?? 0}
                                    onChange={(e) =>
                                      handleUpdateLot(pos.id, lotIdx, 'price', parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full px-2 py-1 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                                  />
                                </div>

                                {/* Delete */}
                                <div className="col-span-1 flex justify-center pt-3">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveLot(pos.id, lotIdx)}
                                    className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                    title="Eliminar lote"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: DEPOSITS EDITING */}
          {activeReviewTab === 'deposits' && (
            <div className="w-full flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-700">Histórico de Depósitos e Levantamentos</span>
                <button
                  type="button"
                  onClick={handleAddDeposit}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Novo Depósito</span>
                </button>
              </div>

              {deposits.length === 0 ? (
                <div className="p-6 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 text-xs">
                  Nenhum depósito registado. Clique em "Novo Depósito" para adicionar.
                </div>
              ) : (
                deposits.map((dep) => (
                  <div
                    key={dep.id}
                    className="p-3.5 bg-white rounded-2xl border border-slate-200 shadow-2xs flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider mb-1">
                          Data do Movimento
                        </label>
                        <input
                          type="text"
                          value={dep.date}
                          onChange={(e) => handleUpdateDeposit(dep.id, 'date', e.target.value)}
                          placeholder="DD/MM/AAAA"
                          className="w-full min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                        />
                      </div>

                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider mb-1">
                          Montante ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={dep.amount}
                          onChange={(e) =>
                            handleUpdateDeposit(dep.id, 'amount', parseFloat(e.target.value) || 0)
                          }
                          className="w-full min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveDeposit(dep.id)}
                        className="mt-5 min-h-[44px] w-10 flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 transition-colors"
                        title="Eliminar depósito"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={dep.comment || ''}
                      onChange={(e) => handleUpdateDeposit(dep.id, 'comment', e.target.value)}
                      placeholder="Descrição / Comentário (opcional)"
                      className="w-full px-3 py-2 bg-slate-50/80 border border-slate-200 rounded-xl text-xs text-slate-700"
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: CURRENCY & FX SETTINGS */}
          {activeReviewTab === 'settings' && (
            <div className="w-full flex flex-col gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 text-white shadow-xs flex flex-col gap-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  Moeda do Documento & Câmbio Multi-API
                </span>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-lg font-black text-emerald-400">
                      {detectedCurrency} ({currencySymbol})
                    </span>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-xl p-1 mt-2">
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => handleCurrencyChange(c.code)}
                          className={`min-h-[36px] px-3 py-1 rounded-lg transition-colors cursor-pointer text-xs font-bold ${
                            detectedCurrency === c.code
                              ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-xs'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {c.code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {detectedCurrency !== 'EUR' && (
                    <button
                      type="button"
                      onClick={handleConvertAllToEur}
                      disabled={isLoadingFx}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition-all shadow-md cursor-pointer flex items-center gap-2 active:scale-95"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>Converter Tudo para EUR (€)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Fixed iPhone Action Bar (Bottom Safe Area) */}
          <div className="fixed bottom-[68px] left-0 right-0 p-3.5 bg-white/95 backdrop-blur-md border-t border-slate-200 flex items-center justify-between gap-3 max-w-md mx-auto z-30 shadow-2xl rounded-t-2xl">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[48px] px-4 py-3 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors cursor-pointer active:scale-95"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleAcceptAndSave}
              disabled={isSavingToDb || positions.length === 0}
              className="flex-1 min-h-[48px] py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50 active:scale-98"
            >
              {isSavingToDb ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>A Guardar Portfólio...</span>
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  <span>Aceitar e Guardar no Portfólio ({positions.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Yahoo Finance Ticker Search Modal */}
      {editingPosId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-4 shadow-xl border border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Pesquisar Ticker Yahoo Finance</h3>
              <button
                type="button"
                onClick={() => setEditingPosId(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePerformSearch()}
                placeholder="Ex: SXR8, Apple, Vanguard..."
                className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={handlePerformSearch}
                disabled={isSearching}
                className="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
              >
                {isSearching ? '...' : 'Buscar'}
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto flex flex-col gap-1 divide-y divide-slate-100">
              {searchResults.length === 0 && !isSearching && (
                <div className="text-center py-4 text-xs text-slate-400">
                  Escreve o nome da ação/ETF e carrega em Buscar.
                </div>
              )}
              {searchResults.map((res: any, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectTicker(res.symbol, res.shortname || res.longname)}
                  className="py-2 px-2 text-left hover:bg-slate-50 rounded flex items-center justify-between cursor-pointer"
                >
                  <div className="truncate">
                    <span className="font-mono font-bold text-xs text-blue-700 block">
                      {res.symbol}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate block">
                      {res.shortname || res.longname}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 ml-2">
                    {res.quoteType || 'EQUITY'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Backup Modal - Screen sized balloon with max 5 backups list & restore */}
      {isBackupModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-md h-[88vh] bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col justify-between relative overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Backups na Nuvem</h3>
                  <p className="text-[11px] text-slate-400 font-medium">Histórico dos últimos 5 backups</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBackupModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Notification message */}
            {backupNotification && (
              <div className="my-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-2xs">
                <span>{backupNotification}</span>
                <button type="button" onClick={() => setBackupNotification(null)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Modal Content: Create Backup button + Backups list */}
            <div className="flex-1 overflow-y-auto py-3 space-y-4 no-scrollbar">
              {/* Button to Create Backup */}
              <button
                type="button"
                onClick={handleCreateNewBackup}
                disabled={isCreatingBackup}
                className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-700 active:scale-98 text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isCreatingBackup ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>A guardar backup na nuvem...</span>
                  </>
                ) : (
                  <>
                    <CloudDownload className="w-4 h-4" />
                    <span>Criar Novo Backup</span>
                  </>
                )}
              </button>

              {/* List of 5 latest backups */}
              <div className="space-y-2.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Últimos 5 Backups
                </span>

                {isLoadingBackups && (
                  <div className="py-8 text-center text-xs text-slate-400">
                    <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    A carregar backups...
                  </div>
                )}

                {!isLoadingBackups && backupsList.length === 0 && (
                  <div className="py-8 text-center text-xs text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                    Nenhum backup encontrado na nuvem.
                    <br />
                    Clica em "Criar Novo Backup" acima.
                  </div>
                )}

                {!isLoadingBackups &&
                  backupsList.map((bk, idx) => (
                    <div
                      key={bk.id}
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3 hover:bg-slate-100/80 transition-all"
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800 tabular-nums">
                            {bk.formattedDate}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-700 uppercase">
                              Mais recente
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium mt-0.5">
                          {bk.holdingsCount} {bk.holdingsCount === 1 ? 'posição' : 'posições'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRestoreBackupItem(bk)}
                        disabled={restoringBackupId === bk.id}
                        className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-sky-700 hover:bg-sky-50 hover:border-sky-300 text-xs font-bold transition-all cursor-pointer shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {restoringBackupId === bk.id ? (
                          <div className="w-3.5 h-3.5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        <span>Restaurar</span>
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 text-center">
              <span className="text-[11px] text-slate-400 font-medium">
                Guarda automaticamente até 5 backups na nuvem.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
