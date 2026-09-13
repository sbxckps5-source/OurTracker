import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseServiceAccountKey(rawInput) {
  if (!rawInput) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY está vazio.');
  }

  let str = rawInput.trim();

  // Se estiver envolvido em aspas extras acidentais
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }

  // Se tiver sido colado em formato Base64
  if (!str.startsWith('{') && /^[A-Za-z0-9+/=\s]+$/.test(str)) {
    try {
      const decoded = Buffer.from(str.replace(/\s+/g, ''), 'base64').toString('utf-8').trim();
      if (decoded.startsWith('{')) {
        str = decoded;
      }
    } catch (_) {}
  }

  // 1. Tentar JSON.parse direto
  try {
    const parsed = JSON.parse(str);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (e1) {
    // 2. Tentar reparar quebras de linha literais dentro dos campos (comum em GitHub Secrets)
    try {
      const repaired = str.replace(/"private_key"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"|\s*\})/g, (match, keyContent) => {
        const escaped = keyContent.replace(/\r?\n/g, '\\n');
        return `"private_key": "${escaped}"`;
      });
      const parsed = JSON.parse(repaired);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (_) {}

    // 3. Extração por Regex direta das propriedades essenciais
    const projectIdMatch = str.match(/"project_id"\s*:\s*"([^"]+)"/);
    const clientEmailMatch = str.match(/"client_email"\s*:\s*"([^"]+)"/);
    const privateKeyMatch = str.match(/"private_key"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*\})/);

    if (projectIdMatch && clientEmailMatch && privateKeyMatch) {
      let key = privateKeyMatch[1].replace(/\\n/g, '\n').replace(/\r/g, '');
      return {
        type: 'service_account',
        project_id: projectIdMatch[1],
        client_email: clientEmailMatch[1],
        private_key: key,
      };
    }

    throw e1;
  }
}

const serviceAccountKeyEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKeyEnv) {
  console.error('❌ ERRO: A variável de ambiente FIREBASE_SERVICE_ACCOUNT_KEY não está definida.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = parseServiceAccountKey(serviceAccountKeyEnv);
  console.log(`✅ Credenciais do Firebase carregadas com sucesso para o projeto: ${serviceAccount.project_id}`);
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
