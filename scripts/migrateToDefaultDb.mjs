import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

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

// Lista de bases de dados de origem possíveis
const candidateSourceDbIds = [
  process.env.SOURCE_DATABASE_ID,
  'ai-studio-ourtracker-d269b44d-bb64-42ab-8187-1d0e7de7e72c',
  'ai-studio-ourtracker-a6232195-a0c1-4196-8aea-276fd2cc0112',
].filter(Boolean);

// Destino: Base de dados nativa (default)
const targetDb = getFirestore(app);

// Função recursiva para exportar todos os documentos e subcoleções de uma base
async function dumpAllFromDb(databaseInstance, dbName) {
  const result = {};
  try {
    const rootCollections = await databaseInstance.listCollections();
    console.log(`🔍 [${dbName}] Encontradas ${rootCollections.length} coleções de topo.`);

    for (const col of rootCollections) {
      result[col.id] = await dumpCollection(col, dbName);
    }
  } catch (err) {
    console.warn(`⚠️ Aviso ao ler base [${dbName}]: ${err.message}`);
  }
  return result;
}

async function dumpCollection(colRef, dbName) {
  const colData = {};
  const snapshot = await colRef.get();
  console.log(`   📂 [${dbName}] Lendo coleção "${colRef.path}": ${snapshot.size} documento(s)`);

  for (const docSnap of snapshot.docs) {
    const docData = docSnap.data();
    const subCollections = await docSnap.ref.listCollections();
    const subColData = {};

    for (const subCol of subCollections) {
      subColData[subCol.id] = await dumpCollection(subCol, dbName);
    }

    colData[docSnap.id] = {
      _data: docData,
      _subcollections: subColData,
    };
  }
  return colData;
}

// Função para apagar recursivamente uma coleção
async function deleteCollectionRecursively(colRef) {
  const snapshot = await colRef.get();
  for (const docSnap of snapshot.docs) {
    const subCollections = await docSnap.ref.listCollections();
    for (const subCol of subCollections) {
      await deleteCollectionRecursively(subCol);
    }
    await docSnap.ref.delete();
  }
}

// Função para restaurar recursivamente dados num Firestore
async function restoreCollectionData(targetColRef, colData) {
  for (const [docId, docObj] of Object.entries(colData)) {
    const targetDocRef = targetColRef.doc(docId);
    if (docObj._data && Object.keys(docObj._data).length > 0) {
      await targetDocRef.set(docObj._data, { merge: true });
      console.log(`   ↳ 💾 Gravado documento: ${targetDocRef.path}`);
    }

    if (docObj._subcollections) {
      for (const [subColId, subColData] of Object.entries(docObj._subcollections)) {
        const targetSubColRef = targetDocRef.collection(subColId);
        await restoreCollectionData(targetSubColRef, subColData);
      }
    }
  }
}

// Função de fusão recursiva de árvores de dados
function mergeDataTrees(target, source) {
  for (const key of Object.keys(source)) {
    if (!target[key]) {
      target[key] = source[key];
    } else {
      // Se tiver _data, fundir campos
      if (source[key]._data) {
        target[key]._data = { ...(target[key]._data || {}), ...source[key]._data };
      }
      // Se tiver subcoleções, fundir recursivamente
      if (source[key]._subcollections) {
        target[key]._subcollections = target[key]._subcollections || {};
        for (const subKey of Object.keys(source[key]._subcollections)) {
          target[key]._subcollections[subKey] = target[key]._subcollections[subKey] || {};
          mergeDataTrees(target[key]._subcollections[subKey], source[key]._subcollections[subKey]);
        }
      }
    }
  }
}

async function runFullBackupAndMigration() {
  console.log(`\n=======================================================`);
  console.log(`🚀 INICIANDO BACKUP, LIMPEZA E RESTAURO UNIFICADO NA (default)`);
  console.log(`=======================================================\n`);

  const consolidatedBackup = {};

  // 1. Fazer backup do que já existe na base (default)
  console.log(`📦 1. A ler e fazer backup da base [(default)] atual...`);
  const defaultExistingData = await dumpAllFromDb(targetDb, '(default)');
  fs.writeFileSync('backup_default_before_reset.json', JSON.stringify(defaultExistingData, null, 2));
  console.log(`   ✅ Backup da (default) guardado em backup_default_before_reset.json`);
  mergeDataTrees(consolidatedBackup, defaultExistingData);

  // 2. Fazer backup de cada base de dados de origem nomeada
  for (const sourceDbId of candidateSourceDbIds) {
    console.log(`\n📦 2. A ler dados da base [${sourceDbId}]...`);
    try {
      const sourceDb = getFirestore(app, sourceDbId);
      const sourceData = await dumpAllFromDb(sourceDb, sourceDbId);
      mergeDataTrees(consolidatedBackup, sourceData);
      console.log(`   ✅ Dados de [${sourceDbId}] lidos e unificados no backup.`);
    } catch (err) {
      console.warn(`   ⚠️ Não foi possível ler [${sourceDbId}]: ${err.message}`);
    }
  }

  // Guardar backup consolidado total em disco
  fs.writeFileSync('backup_consolidado_todas_bases.json', JSON.stringify(consolidatedBackup, null, 2));
  console.log(`\n💾 ✅ Backup consolidado total guardado em "backup_consolidado_todas_bases.json"!`);

  // 3. Limpar a base de dados (default)
  console.log(`\n🧹 3. A limpar coleções existentes na base [(default)]...`);
  try {
    const existingCollections = await targetDb.listCollections();
    for (const col of existingCollections) {
      console.log(`   🗑️ A limpar coleção "${col.id}"...`);
      await deleteCollectionRecursively(col);
    }
    console.log(`   ✅ Base [(default)] limpa com sucesso.`);
  } catch (err) {
    console.warn(`   ⚠️ Aviso ao limpar (default): ${err.message}`);
  }

  // 4. Restaurar todos os dados unificados na base (default)
  console.log(`\n✨ 4. A restaurar todos os dados unificados na base [(default)]...`);
  for (const [colId, colData] of Object.entries(consolidatedBackup)) {
    console.log(`📂 A restaurar coleção "${colId}" na base (default)...`);
    const targetColRef = targetDb.collection(colId);
    await restoreCollectionData(targetColRef, colData);
  }

  console.log(`\n🎉 MIGRAÇÃO E RESTAURO CONCLUÍDOS COM SUCESSO!`);
  console.log(`A base (default) agora contém todos os teus dados unificados sem duplicações.\n`);
}

runFullBackupAndMigration().catch((err) => {
  console.error('❌ Falha crítica durante o processo:', err);
  process.exit(1);
});
