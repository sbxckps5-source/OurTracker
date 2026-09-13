import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountKeyEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKeyEnv) {
  console.error('❌ ERRO: A variável de ambiente FIREBASE_SERVICE_ACCOUNT_KEY não está definida.');
  process.exit(1);
}

function parseServiceAccountKey(rawKey) {
  let cleaned = rawKey.trim();
  if (
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('"') && cleaned.endsWith('"'))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
  return JSON.parse(cleaned);
}

let serviceAccount;
try {
  serviceAccount = parseServiceAccountKey(serviceAccountKeyEnv);
} catch (err) {
  console.error('❌ ERRO ao interpretar o JSON da Service Account:', err.message);
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id || 'gen-lang-client-0800917980',
});

const NAMED_DB_ID = 'ai-studio-ourtracker-a6232195-a0c1-4196-8aea-276fd2cc0112';

// 1. Origem: Base de dados nomeada antiga
const sourceDb = getFirestore(app, NAMED_DB_ID);
// 2. Destino: Base de dados nativa (default) gratuita
const targetDb = getFirestore(app);

async function copyCollection(sourceColRef, targetColRef) {
  const snapshot = await sourceColRef.get();
  console.log(`📂 A migrar coleção "${sourceColRef.path}": ${snapshot.size} documento(s) encontrado(s).`);

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const targetDocRef = targetColRef.doc(docSnap.id);

    // Copiar documento preservando todos os campos
    await targetDocRef.set(data, { merge: true });
    console.log(`   ↳ ✅ Documento copiado com sucesso: ${targetDocRef.path}`);

    // Verificar e copiar subcoleções recursivamente
    const subCollections = await docSnap.ref.listCollections();
    for (const subCol of subCollections) {
      const targetSubColRef = targetDocRef.collection(subCol.id);
      await copyCollection(subCol, targetSubColRef);
    }
  }
}

async function runMigration() {
  console.log(`\n=======================================================`);
  console.log(`🚀 INICIANDO MIGRAÇÃO DO FIRESTORE`);
  console.log(`   Origem  : [${NAMED_DB_ID}]`);
  console.log(`   Destino : [(default) - Plano Gratuito Spark]`);
  console.log(`=======================================================\n`);

  const rootCollections = await sourceDb.listCollections();
  if (rootCollections.length === 0) {
    console.log(`⚠️ Nenhuma coleção de topo encontrada na base de origem.`);
    return;
  }

  for (const col of rootCollections) {
    const targetColRef = targetDb.collection(col.id);
    await copyCollection(col, targetColRef);
  }

  console.log(`\n✨ MIGRAÇÃO CONCLUÍDA COM SUCESSO!`);
  console.log(`Todos os dados, subcoleções e históricos de snapshots foram replicados na base (default).\n`);
}

runMigration().catch((err) => {
  console.error('❌ Falha crítica durante a migração:', err);
  process.exit(1);
});
