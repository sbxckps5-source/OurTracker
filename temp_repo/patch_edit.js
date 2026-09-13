const fs = require('fs');

const path = 'src/components/EditPortfolio.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Add deposit state
code = code.replace(
  /const \[isDeleting, setIsDeleting\] = useState<string \| null>\(null\);/,
  `const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  // Deposits state
  const [deposits, setDeposits] = useState<any[]>([]);
  const [isDepositsExpanded, setIsDepositsExpanded] = useState<boolean>(false);
  const [editingDeposit, setEditingDeposit] = useState<{ index: number } | null>(null);
  const [editDepositAmount, setEditDepositAmount] = useState<string>('');
  const [editDepositDate, setEditDepositDate] = useState<string>('');`
);

// 2. Add meta subscription
code = code.replace(
  /const unsub = subscribeUserHoldings\('main', \(data\) => {/,
  `const unsubMeta = onSnapshot(doc(db, 'portfolios', 'main'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Sort deposits by date descending
        const deps = (data.deposits || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setDeposits(deps);
      } else {
        setDeposits([]);
      }
    });

    const unsub = subscribeUserHoldings('main', (data) => {`
);

// 3. Fix useEffect cleanup
code = code.replace(
  /return \(\) => unsub\(\);/,
  `return () => { unsub(); unsubMeta(); };`
);

// 4. Update import for onSnapshot
code = code.replace(
  /import { deleteDoc, doc, updateDoc } from 'firebase\/firestore';/,
  `import { deleteDoc, doc, updateDoc, onSnapshot } from 'firebase/firestore';`
);

fs.writeFileSync(path, code);
