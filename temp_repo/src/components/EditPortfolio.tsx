import React, { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, Edit2, Loader2, ChevronDown, ChevronUp, Save, X, DollarSign } from 'lucide-react';
import { HoldingDoc, PurchaseRecord } from '../types';
import { db } from '../firebase';
import { deleteDoc, doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { subscribeUserHoldings } from '../services/portfolioService';
import { getShortDescription } from '../utils/tickerHelper';

interface EditPortfolioProps {
  onBack: () => void;
}

export const EditPortfolio: React.FC<EditPortfolioProps> = ({ onBack }) => {
  const [holdings, setHoldings] = useState<HoldingDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // State for expanded rows
  const [expandedHoldings, setExpandedHoldings] = useState<Record<string, boolean>>({});
  
  // State for editing a specific purchase
  const [editingPurchase, setEditingPurchase] = useState<{ holdingId: string; purchaseIndex: number } | null>(null);
  const [editShares, setEditShares] = useState<string>('');
  const [editPrice, setEditPrice] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [isSavingPurchase, setIsSavingPurchase] = useState(false);

  // State for adding a new lot to an existing holding
  const [addingLotTicker, setAddingLotTicker] = useState<string | null>(null);
  const [newLotShares, setNewLotShares] = useState<string>('');
  const [newLotPrice, setNewLotPrice] = useState<string>('');
  const [newLotDate, setNewLotDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isAddingLot, setIsAddingLot] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmText?: string;
  } | null>(null);

  const confirmAction = (title: string, message: string, onConfirm: () => void, confirmText: string = "Eliminar", onCancel?: () => void) => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm, onCancel, confirmText });
  };

  const closeConfirm = () => {
    if (confirmDialog?.onCancel) {
      confirmDialog.onCancel();
    }
    setConfirmDialog(null);
  };


  // Deposits state
  const [deposits, setDeposits] = useState<any[]>([]);
  const [isDepositsExpanded, setIsDepositsExpanded] = useState<boolean>(true);
  const [editingDeposit, setEditingDeposit] = useState<{ index: number } | null>(null);
  const [editDepositAmount, setEditDepositAmount] = useState<string>('');
  const [editDepositDate, setEditDepositDate] = useState<string>('');

  useEffect(() => {
    const unsubMeta = onSnapshot(doc(db, 'portfolios', 'main'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const deps = (data.deposits || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setDeposits(deps);
      } else {
        setDeposits([]);
      }
    });

    const unsub = subscribeUserHoldings('main', (data) => {
      setHoldings(data);
      setIsLoading(false);
    });
    return () => { unsub(); unsubMeta(); };
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedHoldings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const startEditingPurchase = (holdingId: string, purchase: PurchaseRecord, index: number) => {
    setEditingPurchase({ holdingId, purchaseIndex: index });
    setEditShares(purchase.shares.toString());
    setEditPrice(purchase.priceEur !== undefined ? purchase.priceEur.toString() : (purchase.price !== undefined ? purchase.price.toString() : ''));
    setEditDate(purchase.date ? new Date(purchase.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  };

  const savePurchaseEdit = async (holding: HoldingDoc, purchaseIndex: number) => {
    setIsSavingPurchase(true);
    try {
      const newShares = parseFloat(editShares);
      const newPrice = parseFloat(editPrice);
      const parsedDate = new Date(editDate);
      
      if (isNaN(newShares) || newShares <= 0) {
        alert("Unidades inválidas.");
        setIsSavingPurchase(false);
        return;
      }
      if (isNaN(parsedDate.getTime())) {
        alert("Data inválida.");
        setIsSavingPurchase(false);
        return;
      }
      
      const updatedPurchases = [...(holding.purchases || [])];
      
      if (updatedPurchases[purchaseIndex]) {
        updatedPurchases[purchaseIndex] = {
          ...updatedPurchases[purchaseIndex],
          shares: newShares,
          date: parsedDate.getTime(),
          ...(isNaN(newPrice) ? {} : { priceEur: newPrice, price: newPrice })
        };
      }
      
      const totalShares = updatedPurchases.reduce((acc, curr) => acc + curr.shares, 0);
      
      await updateDoc(doc(db, 'portfolios', 'main', 'holdings', holding.id), {
        shares: totalShares,
        purchases: updatedPurchases
      });
      
      setEditingPurchase(null);
    } catch (err) {
      console.error(err);
      alert("Erro ao guardar.");
    } finally {
      setIsSavingPurchase(false);
    }
  };

  const saveNewLot = async (holding: HoldingDoc) => {
    setIsAddingLot(true);
    try {
      const shares = parseFloat(newLotShares);
      const price = parseFloat(newLotPrice);
      const parsedDate = new Date(newLotDate);

      if (isNaN(shares) || shares <= 0) {
        alert("Unidades inválidas.");
        setIsAddingLot(false);
        return;
      }
      if (isNaN(price) || price < 0) {
        alert("Preço inválido.");
        setIsAddingLot(false);
        return;
      }
      if (isNaN(parsedDate.getTime())) {
        alert("Data inválida.");
        setIsAddingLot(false);
        return;
      }

      const existingPurchases = holding.purchases || [];
      const newPurchaseRecord: PurchaseRecord = {
        id: `p-${Date.now()}`,
        shares: shares,
        price: price,
        priceEur: price,
        date: parsedDate.getTime()
      };

      const updatedPurchases = [newPurchaseRecord, ...existingPurchases];
      const totalShares = updatedPurchases.reduce((acc, curr) => acc + curr.shares, 0);

      await updateDoc(doc(db, 'portfolios', 'main', 'holdings', holding.id), {
        shares: totalShares,
        purchases: updatedPurchases
      });

      setAddingLotTicker(null);
      setNewLotShares('');
      setNewLotPrice('');
    } catch (err) {
      console.error(err);
      alert("Erro ao adicionar lote.");
    } finally {
      setIsAddingLot(false);
    }
  };

  
  const handleDeleteHoldingDirect = async (holdingId: string) => {
    setIsDeleting(holdingId);
    try {
      await deleteDoc(doc(db, 'portfolios', 'main', 'holdings', holdingId));
    } catch (error) {
      console.error("Error deleting document: ", error);
      alert("Erro ao eliminar a posição.");
    } finally {
      setIsDeleting(null);
    }
  };

  const deletePurchase = async (holding: HoldingDoc, purchaseIndex: number) => {
    confirmAction(
      "Eliminar Registo",
      "Tens a certeza que queres eliminar este registo?",
      async () => {
        setConfirmDialog(null);
        try {
          const updatedPurchases = [...(holding.purchases || [])];
          updatedPurchases.splice(purchaseIndex, 1);
          
          if (updatedPurchases.length === 0) {
            confirmAction(
              "Eliminar Ativo",
              "Esta era a última posição detalhada deste ativo. Queres eliminar o ativo inteiro da tua carteira?",
              async () => {
                setConfirmDialog(null);
                await handleDeleteHoldingDirect(holding.id);
              },
              "Sim, eliminar",
              async () => {
                try {
                  await updateDoc(doc(db, 'portfolios', 'main', 'holdings', holding.id), {
                    shares: 0,
                    purchases: []
                  });
                } catch(e) {}
              }
            );
          } else {
            const totalShares = updatedPurchases.reduce((acc, curr) => acc + curr.shares, 0);
            await updateDoc(doc(db, 'portfolios', 'main', 'holdings', holding.id), {
              shares: totalShares,
              purchases: updatedPurchases
            });
          }
        } catch (err) {
          console.error(err);
          alert("Erro ao eliminar.");
        }
      }
    );
  };

  const startEditingDeposit = (index: number, dep: any) => {
    setEditingDeposit({ index });
    setEditDepositAmount(dep.amount.toString());
    setEditDepositDate(new Date(dep.date).toISOString().split('T')[0]);
  };

  const saveDepositEdit = async (index: number) => {
    try {
      const newAmount = parseFloat(editDepositAmount);
      if (isNaN(newAmount) || newAmount <= 0) {
        alert("Montante inválido.");
        return;
      }
      
      const parsedDate = new Date(editDepositDate);
      if (isNaN(parsedDate.getTime())) {
        alert("Data inválida.");
        return;
      }

      const updatedDeposits = [...deposits];
      updatedDeposits[index] = {
        ...updatedDeposits[index],
        amount: newAmount,
        date: parsedDate.toISOString()
      };

      await updateDoc(doc(db, 'portfolios', 'main'), {
        deposits: updatedDeposits
      });
      setEditingDeposit(null);
    } catch(err) {
      console.error(err);
      alert("Erro ao editar depósito.");
    }
  };

  const deleteDeposit = async (index: number) => {
    confirmAction(
      "Apagar Depósito",
      "Tens a certeza que queres apagar este depósito?",
      async () => {
        setConfirmDialog(null);
        try {
          const updatedDeposits = [...deposits];
          updatedDeposits.splice(index, 1);
          
          await updateDoc(doc(db, 'portfolios', 'main'), {
            deposits: updatedDeposits
          });
        } catch(err) {
          console.error(err);
          alert("Erro ao apagar depósito.");
        }
      }
    );
  };

  const handleDeleteHolding = async (holdingId: string, tickerName: string) => {
    confirmAction(
      "Eliminar Posição",
      `Tens a certeza que queres eliminar toda a posição de ${tickerName}?`,
      async () => {
        setConfirmDialog(null);
        await handleDeleteHoldingDirect(holdingId);
      }
    );
  };

return (
    <div className="w-full h-full flex flex-col bg-slate-50">
      <div className="py-3 px-5 bg-white border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">
          Gerir Portfólio
        </h2>
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-800 p-1 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
          </div>
        ) : (holdings.length === 0 && deposits.length === 0) ? (
          <div className="text-center py-10 text-slate-500 font-medium text-sm">
            Nenhuma posição encontrada na carteira.
          </div>
        ) : (
          <div className="flex flex-col bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">

            {deposits && deposits.length > 0 && (
              <div className="flex flex-col border-b-4 border-slate-100 bg-blue-50/30">
                <div 
                  className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setIsDepositsExpanded(!isDepositsExpanded)}
                >
                  <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shadow-xs">
                        <DollarSign className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900">Depósitos</span>
                        <span className="text-xs text-slate-500">{deposits.length} transações</span>
                      </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end mr-2">
                      <span className="font-bold text-slate-900">
                        {deposits.reduce((acc, curr) => acc + (curr.amount || 0), 0).toFixed(2)}€
                      </span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wide">Total Depositado</span>
                    </div>
                    <div className="p-1 rounded-full bg-white border border-slate-200 text-slate-400">
                      {isDepositsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {isDepositsExpanded && (
                  <div className="bg-white border-t border-slate-100 p-4 flex flex-col gap-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Histórico de Entradas</h4>
                    {deposits.map((dep, index) => {
                      const isEditing = editingDeposit?.index === index;
                      if (isEditing) {
                        return (
                          <div key={index} className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col gap-3 shadow-xs">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Montante (€)</label>
                                <input 
                                  type="number" 
                                  value={editDepositAmount}
                                  onChange={(e) => setEditDepositAmount(e.target.value)}
                                  className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-200"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Data</label>
                                <input 
                                  type="date" 
                                  value={editDepositDate}
                                  onChange={(e) => setEditDepositDate(e.target.value)}
                                  className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-200"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 justify-end mt-1">
                              <button 
                                onClick={() => setEditingDeposit(null)}
                                className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={() => saveDepositEdit(index)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold transition-colors cursor-pointer shadow-xs"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Guardar
                              </button>
                            </div>

      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-900 mb-2">{confirmDialog.title}</h3>
              <p className="text-slate-600 text-sm">{confirmDialog.message}</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button 
                onClick={closeConfirm}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-sm font-bold bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-colors shadow-sm"
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

}
                      return (
                        <div key={index} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-2xs">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 font-medium">
                              {new Date(dep.date).toLocaleDateString('pt-PT')}
                            </span>
                            <span className="font-bold text-sm text-slate-900 mt-0.5">€{dep.amount?.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); startEditingDeposit(index, dep); }}
                              className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteDeposit(index); }}
                              className="p-2 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {holdings.map((h) => {
              const tickerStr = h.ticker;
              const shortName = getShortDescription(tickerStr, "");
              const isExpanded = !!expandedHoldings[h.id];

              return (
                <div key={h.id} className="flex flex-col border-b border-slate-100 last:border-0">
                  {/* Main row */}
                  <div 
                    className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(h.id)}
                  >
                    <div className="flex items-center gap-4">
                       <span
                         className="w-4 h-4 rounded-full flex-shrink-0 shadow-xs"
                         style={{ backgroundColor: h.color || '#334155' }}
                       />
                       <div className="flex flex-col">
                          <span className="font-bold text-slate-900">{tickerStr}</span>
                          <span className="text-xs text-slate-500 truncate max-w-[120px]">{shortName || 'Ativo Financeiro'}</span>
                       </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-end mr-2">
                        <span className="font-bold text-slate-900">{h.shares}</span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Unidades</span>
                      </div>
                      <div className="p-1 rounded-full bg-slate-100 text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>
                  
                  {/* Expanded view */}
                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-100 p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Histórico de Posições</h4>
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddingLotTicker(addingLotTicker === h.id ? null : h.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors text-[11px] font-bold cursor-pointer shadow-xs"
                        >
                          <span>+ Adicionar Lote</span>
                        </button>
                      </div>

                      {addingLotTicker === h.id && (
                        <div className="bg-white p-3 rounded-xl border border-blue-200 flex flex-col gap-3 shadow-sm my-2">
                          <div className="text-xs font-bold text-blue-900">Novo lote para {h.ticker}</div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Data</label>
                              <input 
                                type="date" 
                                value={newLotDate}
                                onChange={(e) => setNewLotDate(e.target.value)}
                                className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Unidades</label>
                              <input 
                                type="number" 
                                step="0.0001"
                                placeholder="0.0000"
                                value={newLotShares}
                                onChange={(e) => setNewLotShares(e.target.value)}
                                className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Preço (€)</label>
                              <input 
                                type="number" 
                                placeholder="0.00"
                                value={newLotPrice}
                                onChange={(e) => setNewLotPrice(e.target.value)}
                                className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 justify-end mt-1">
                            <button 
                              onClick={() => setAddingLotTicker(null)}
                              className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button 
                              onClick={() => saveNewLot(h)}
                              disabled={isAddingLot}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                            >
                              {isAddingLot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              Guardar Lote
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {(!h.purchases || h.purchases.length === 0) ? (
                        <div className="text-[11px] text-slate-400 italic">Sem registo detalhado (apenas unidade global).</div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {h.purchases.map((p, index) => {
                            const isEditing = editingPurchase?.holdingId === h.id && editingPurchase?.purchaseIndex === index;
                            
                            if (isEditing) {
                              return (
                                <div key={p.id || index} className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col gap-3 shadow-xs">
                                  <div className="flex items-center gap-3">
                                    <div className="flex-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase">Unidades</label>
                                      <input 
                                        type="number" 
                                        value={editShares}
                                        onChange={(e) => setEditShares(e.target.value)}
                                        className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-200"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase">Preço (€)</label>
                                      <input 
                                        type="number" 
                                        value={editPrice}
                                        onChange={(e) => setEditPrice(e.target.value)}
                                        className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-200"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 justify-end mt-1">
                                    <button 
                                      onClick={() => setEditingPurchase(null)}
                                      className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                    <button 
                                      onClick={() => savePurchaseEdit(h, index)}
                                      disabled={isSavingPurchase}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black text-white hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
                                    >
                                      {isSavingPurchase ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                      Guardar
                                    </button>
                                  </div>
                                </div>
                              );
                            }
                            
                            return (
                              <div key={p.id || index} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between shadow-2xs">
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {new Date(p.date).toLocaleDateString('pt-PT')}
                                  </span>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="font-bold text-sm text-slate-900">{p.shares} un.</span>
                                    <span className="text-slate-300">•</span>
                                    <span className="text-[13px] text-slate-600 font-medium">{p.priceEur !== undefined ? `€${p.priceEur.toFixed(2)}` : (p.price !== undefined ? `${p.price.toFixed(2)}` : 'N/A')}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); startEditingPurchase(h.id, p, index); }}
                                    className="p-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); deletePurchase(h, index); }}
                                    className="p-2 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 hover:text-rose-600 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-900 mb-2">{confirmDialog.title}</h3>
              <p className="text-slate-600 text-sm">{confirmDialog.message}</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button 
                onClick={closeConfirm}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-sm font-bold bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-colors shadow-sm cursor-pointer"
              >
                {confirmDialog.confirmText || 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
};
