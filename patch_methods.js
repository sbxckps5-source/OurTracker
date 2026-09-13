const fs = require('fs');

const path = 'src/components/EditPortfolio.tsx';
let code = fs.readFileSync(path, 'utf8');

// Replace methods
const methodsBlockStart = code.indexOf('const startEditingPurchase');
const methodsBlockEnd = code.indexOf('const handleDeleteHolding') - 1;

const newMethods = `
  const startEditingPurchase = (holdingId: string, purchase: PurchaseRecord) => {
    setEditingPurchase({ holdingId, purchaseId: purchase.id || '' });
    setEditShares(purchase.shares.toString());
    setEditPrice(purchase.priceEur !== undefined ? purchase.priceEur.toString() : (purchase.price !== undefined ? purchase.price.toString() : ''));
  };

  const savePurchaseEdit = async (holding: HoldingDoc, purchase: PurchaseRecord, purchaseIndex: number) => {
    setIsSavingPurchase(true);
    try {
      const newShares = parseFloat(editShares);
      const newPrice = parseFloat(editPrice);
      
      if (isNaN(newShares) || newShares <= 0) {
        alert("Unidades inválidas.");
        setIsSavingPurchase(false);
        return;
      }
      
      const updatedPurchases = [...(holding.purchases || [])];
      
      // Update by index instead of ID just to be absolutely safe (some might not have IDs)
      if (updatedPurchases[purchaseIndex]) {
        updatedPurchases[purchaseIndex] = {
          ...updatedPurchases[purchaseIndex],
          shares: newShares,
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

  const deletePurchase = async (holding: HoldingDoc, purchaseIndex: number) => {
    if (!window.confirm("Tens a certeza que queres eliminar este registo?")) return;
    
    try {
      const updatedPurchases = [...(holding.purchases || [])];
      updatedPurchases.splice(purchaseIndex, 1);
      
      if (updatedPurchases.length === 0) {
        if (window.confirm("Esta era a última posição detalhada deste ativo. Queres eliminar o ativo inteiro da tua carteira?")) {
          await handleDeleteHolding(holding.id, holding.ticker);
        } else {
          await updateDoc(doc(db, 'portfolios', 'main', 'holdings', holding.id), {
            shares: 0,
            purchases: []
          });
        }
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
    if (!window.confirm("Tens a certeza que queres apagar este depósito?")) return;
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
  };
`;

code = code.substring(0, methodsBlockStart) + newMethods + code.substring(methodsBlockEnd);
fs.writeFileSync(path, code);
