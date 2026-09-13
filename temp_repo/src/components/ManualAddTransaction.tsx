import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronDown, Info, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { convertTickerToYahoo } from '../utils/yahooClient';
import { searchYahoo } from '../services/yahooResolver';
import { DISTINCT_PALETTE } from '../services/portfolioService';

const DEFAULT_SECURITIES = [
  { symbol: 'CSPX.AS', name: 'Core S&P 500 ETF', type: 'ETP' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', type: 'Stock', icon: 'Alphabet', color: 'text-rose-500' },
  { symbol: 'AMZN', name: 'Amazon', type: 'Stock', icon: 'a', color: 'text-orange-500 font-serif' },
  { symbol: 'SKHY', name: 'SK hynix Inc. Sponsored ADR', type: 'Stock', icon: 'SKH', color: 'text-slate-900' },
  { symbol: 'LEU', name: 'Centrus Energy', type: 'Stock', icon: 'LEU', color: 'text-emerald-600' },
  { symbol: 'SPCX', name: 'SpaceX', type: 'Stock', icon: 'X', color: 'text-slate-900 font-serif' },
  { symbol: 'ORCL', name: 'Oracle', type: 'Stock', icon: 'O', color: 'text-rose-600' },
  { symbol: 'SMH', name: 'Semiconductor ETF A', type: 'ETP', icon: 'VanEck', color: 'text-blue-600 text-[10px]' },
];

interface ManualAddTransactionProps {
  onBack: () => void;
  onSuccess: () => void;
}

export const ManualAddTransaction: React.FC<ManualAddTransactionProps> = ({ onBack, onSuccess }) => {
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('Buy');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [units, setUnits] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const totalAmount = (parseFloat(units || '0') * parseFloat(price || '0')).toFixed(2);

  useEffect(() => {
    if (searchQuery.trim().length > 1 && isSearchFocused) {
      setIsSearching(true);
      const timer = setTimeout(async () => {
        try {
          const results = await searchYahoo(searchQuery);
          setSearchResults(results);
        } catch (e) {
          console.error(e);
        } finally {
          setIsSearching(false);
        }
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, isSearchFocused]);

  const handleSelectAsset = (symbol: string, assetName: string) => {
    setTicker(symbol);
    setName(assetName);
    setSearchQuery(`${assetName} (${symbol})`);
    setIsSearchFocused(false);
  };

  const handleSave = async (addAnother: boolean) => {
    if (!ticker || !units || !price) return;
    setIsSaving(true);
    try {
      const normalizedTicker = convertTickerToYahoo(ticker).toUpperCase();
      const docRef = doc(db, 'portfolios', 'main', 'holdings', normalizedTicker);
      const snap = await getDoc(docRef);
      
      const parsedUnits = parseFloat(units);
      const parsedPrice = parseFloat(price);
      const parsedDate = new Date(date).getTime();
      
      const newPurchase = {
        id: `m-${Date.now()}`,
        date: parsedDate,
        shares: type === 'Buy' ? parsedUnits : -parsedUnits,
        price: parsedPrice,
        priceEur: parsedPrice,
      };

      if (snap.exists()) {
        const data = snap.data();
        const existingPurchases = data.purchases || [];
        existingPurchases.push(newPurchase);
        
        const newShares = (data.shares || 0) + newPurchase.shares;
        
        await setDoc(docRef, {
          shares: newShares,
          purchases: existingPurchases
        }, { merge: true });
      } else {
        await setDoc(docRef, {
          ticker: normalizedTicker,
          name: name || ticker,
          shares: newPurchase.shares,
          createdAt: Date.now(),
          color: DISTINCT_PALETTE[Math.floor(Math.random() * DISTINCT_PALETTE.length)],
          purchases: [newPurchase]
        });
      }
      
      if (addAnother) {
        setUnits('');
        setPrice('');
        setTicker('');
        setName('');
      } else {
        onSuccess();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const displayList = searchQuery && searchResults.length > 0 
    ? searchResults.map(r => ({ symbol: r.symbol, name: r.name, type: r.quoteType || 'Stock' }))
    : DEFAULT_SECURITIES;

  return (
    <div className="w-full h-full bg-white flex flex-col pt-2 relative">
      {/* Header */}
      <div className="flex items-center justify-center relative p-4 mb-4">
        <button onClick={onBack} className="absolute left-4 p-1 -ml-1 text-slate-900 cursor-pointer">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold text-slate-900">Add transaction</h1>
      </div>

      <div className="px-6 flex-1 flex flex-col overflow-hidden">
        {/* Search Bar - No Lupa, No Label */}
        <div className="relative flex items-center bg-[#F4F4F5] rounded-xl overflow-hidden px-4 py-3.5 focus-within:ring-2 focus-within:ring-slate-200 transition-all mb-6 flex-shrink-0">
          <input
            type="text"
            value={searchQuery}
            onFocus={() => {
              setIsSearchFocused(true);
              if (ticker) {
                setSearchQuery('');
                setTicker('');
                setName('');
              }
            }}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, ISIN, etc"
            className="flex-1 bg-transparent border-0 p-0 text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:ring-0 outline-none w-full"
          />
          {isSearching && <Loader2 className="w-5 h-5 animate-spin text-slate-400 flex-shrink-0 ml-2" />}
        </div>

        {isSearchFocused ? (
          <div className="flex-1 overflow-y-auto pb-12 -mx-2 px-2">
            <div className="flex flex-col gap-1">
              {displayList.map((item: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => handleSelectAsset(item.symbol, item.name)}
                  className="w-full flex items-center gap-3 py-1.5 px-2 hover:bg-slate-50 transition-colors rounded-xl cursor-pointer active:scale-98"
                >
                  <div className="w-[36px] h-[36px] rounded-full bg-[#F8F9FA] flex items-center justify-center flex-shrink-0 text-slate-900 font-bold border border-slate-200/60 overflow-hidden">
                    {item.icon ? (
                      <span className={`text-[10px] tracking-tighter ${item.color || ''}`}>
                        {item.icon}
                      </span>
                    ) : item.type === 'ETP' || (item.name && item.name.includes('ETF')) ? (
                      <Info className="w-5 h-5 text-slate-900" />
                    ) : (
                      <span className="text-lg">{(item.name || item.symbol || '?').charAt(0)}</span>
                    )}
                  </div>
                  
                  <div className="flex flex-col items-start overflow-hidden flex-1 border-b border-slate-50 pb-2 pt-1.5">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-bold text-slate-900 truncate">
                        {item.symbol}
                      </span>
                      <span className="px-1.5 py-[1px] rounded-md bg-[#F4F4F5] text-slate-500 text-[9px] font-bold uppercase tracking-wide">
                        {item.type || 'Stock'}
                      </span>
                    </div>
                    <span className="text-[12px] text-slate-400 truncate w-full text-left">
                      {item.name || item.symbol}
                    </span>
                  </div>
                </button>
              ))}
              
              {searchQuery && searchResults.length === 0 && !isSearching && (
                <div className="text-center p-8 text-sm text-slate-400">
                  Nenhum resultado encontrado para "{searchQuery}".
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pb-12 flex flex-col gap-6">
            {/* Type & Date */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-500 mb-2 block">Transaction type</label>
                <div className="relative">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full p-4 bg-slate-50 border-0 rounded-2xl appearance-none text-base font-medium text-slate-900 pr-10 focus:ring-0 cursor-pointer"
                  >
                    <option value="Buy">Buy</option>
                    <option value="Sell">Sell</option>
                  </select>
                  <ChevronDown className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-500 mb-2 block">Transaction date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full p-4 bg-slate-50 border-0 rounded-2xl appearance-none text-base font-medium text-slate-900 pr-10 focus:ring-0 cursor-pointer"
                  />
                  <ChevronDown className="w-5 h-5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Units & Price */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-500 mb-2 block">Units</label>
                <input
                  type="number"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full p-4 bg-slate-50 border-0 rounded-2xl text-base font-medium text-slate-900 placeholder:text-slate-400 focus:ring-0"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-500 mb-2 block">Price per unit</label>
                <div className="relative flex items-center bg-slate-50 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-slate-200">
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-4 bg-transparent border-0 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:ring-0"
                  />
                  <div className="pr-4 flex items-center text-slate-600 font-medium">
                    € <ChevronDown className="w-4 h-4 ml-1" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!isSearchFocused && (
        <div className="w-full bg-white border-t border-slate-100 p-6 flex flex-col gap-4 mt-auto">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">Total amount</span>
            <span className="text-xl font-bold text-slate-900">€{totalAmount}</span>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={!ticker || !units || !price || isSaving}
              className="w-full py-4 bg-black hover:bg-slate-900 active:bg-slate-800 text-white rounded-2xl font-bold text-base transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-5 h-5 animate-spin" />}
              Add transaction
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={!ticker || !units || !price || isSaving}
              className="w-full py-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl font-bold text-base transition-colors cursor-pointer disabled:opacity-50"
            >
              Save and add another
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
