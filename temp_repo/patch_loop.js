const fs = require('fs');

const path = 'src/components/EditPortfolio.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /{h\.purchases\.map\(p => {/g,
  '{h.purchases.map((p, index) => {'
);

code = code.replace(
  /const isEditing = editingPurchase\?\.holdingId === h\.id && editingPurchase\?\.purchaseId === p\.id;/g,
  'const isEditing = editingPurchase?.holdingId === h.id && editingPurchase?.purchaseIndex === index;'
);

code = code.replace(
  /onClick={\(\) => savePurchaseEdit\(h, p\)}/g,
  'onClick={() => savePurchaseEdit(h, index)}'
);

code = code.replace(
  /startEditingPurchase\(h\.id, p\)/g,
  'startEditingPurchase(h.id, p, index)'
);

code = code.replace(
  /deletePurchase\(h, p\.id\)/g,
  'deletePurchase(h, index)'
);

code = code.replace(
  /key={p\.id}/g,
  'key={p.id || index}'
);

fs.writeFileSync(path, code);
