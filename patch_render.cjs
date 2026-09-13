const fs = require('fs');

const path = 'src/components/EditPortfolio.tsx';
let code = fs.readFileSync(path, 'utf8');

const depositsJSX = `
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
`;

code = code.replace(
  '<div className="flex flex-col bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">',
  '<div className="flex flex-col bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">\n' + depositsJSX
);

// We should also modify the "Nenhuma posição" state slightly if there are deposits, but we can just render the container regardless if deposits.length > 0 or holdings.length > 0
code = code.replace(
  /holdings\.length === 0 \? \(/g,
  '(holdings.length === 0 && deposits.length === 0) ? ('
);

fs.writeFileSync(path, code);
