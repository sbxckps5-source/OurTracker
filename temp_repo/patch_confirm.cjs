const fs = require('fs');

const path = 'src/components/EditPortfolio.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Add state
const stateInjection = `
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
`;

code = code.replace(
  'const [isSavingPurchase, setIsSavingPurchase] = useState(false);',
  'const [isSavingPurchase, setIsSavingPurchase] = useState(false);\n' + stateInjection
);

// 2. Replace methods
const methodsStart = code.indexOf('const deletePurchase = async');
const methodsEnd = code.indexOf('return (', methodsStart);

const newMethods = `
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
      \`Tens a certeza que queres eliminar toda a posição de \${tickerName}?\`,
      async () => {
        setConfirmDialog(null);
        await handleDeleteHoldingDirect(holdingId);
      }
    );
  };

`;

code = code.substring(0, methodsStart) + newMethods + code.substring(methodsEnd);

// 3. Add the Modal JSX at the end of the return statement
const modalJSX = `
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
`;

code = code.replace(/<\/div>\s*<\/div>\s*\)\s*;\s*}\s*$/m, '</div>\n' + modalJSX + '\n}');

fs.writeFileSync(path, code);
