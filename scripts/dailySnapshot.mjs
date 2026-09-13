/**
 * scripts/dailySnapshot.mjs
 *
 * Script autónomo executado via GitHub Actions para registar diariamente um
 * snapshot do valor e rentabilidade do portfólio no Firestore.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Validar e inicializar o Firebase Admin SDK com parser tolerante a falhas
function parseServiceAccountKey(rawInput) {
  if (!rawInput) {
    throw new Error('A variável FIREBASE_SERVICE_ACCOUNT_KEY está vazia.');
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
  console.error('❌ ERRO: Falha ao interpretar o JSON de FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id || 'ourtrackerfixed',
});

// A base de dados específica do Firestore
const TARGET_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  process.env.FIREBASE_DATABASE_ID ||
  'ai-studio-ourtracker-d269b44d-bb64-42ab-8187-1d0e7de7e72c';

const db = TARGET_DATABASE_ID && TARGET_DATABASE_ID !== '(default)'
  ? getFirestore(app, TARGET_DATABASE_ID)
  : getFirestore(app);


// 2. Obter taxa de câmbio USD -> EUR via Frankfurter (com fallback)
async function getUsdEurExchangeRate() {
  console.log('🔄 A obter taxa cambial USD/EUR via Frankfurter...');
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.EUR) {
        const rate = Number(data.rates.EUR);
        console.log(`✅ Câmbio obtido: 1 USD = ${rate.toFixed(4)} EUR (Frankfurter)`);
        return rate;
      }
    }
  } catch (err) {
    console.warn('⚠️ Falha ao obter taxa da Frankfurter:', err.message);
  }

  // Fallback 1: open.er-api.com
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.EUR) {
        const rate = Number(data.rates.EUR);
        console.log(`✅ Câmbio obtido: 1 USD = ${rate.toFixed(4)} EUR (OpenErApi)`);
        return rate;
      }
    }
  } catch (err) {
    console.warn('⚠️ Falha no fallback de câmbio:', err.message);
  }

  console.warn('⚠️ A usar taxa de contingência estática: 1 USD = 0.92 EUR');
  return 0.92;
}

// 3. Obter cotação atual de um ticker via Yahoo Finance
async function fetchYahooQuote(ticker, usdToEurRate) {
  const cleanTicker = ticker.trim().toUpperCase();
  const candidates = [];

  // Remover .US caso venha de brokers que anexam o sufixo
  if (cleanTicker.endsWith('.US')) {
    candidates.push(cleanTicker.replace(/\.US$/i, ''));
  }
  candidates.push(cleanTicker);
  if (cleanTicker.startsWith('US.')) {
    candidates.push(cleanTicker.replace(/^US\./i, ''));
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  for (const sym of candidates) {
    for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
      try {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;

        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (!result || !result.meta) continue;

        const meta = result.meta;
        const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0;
        if (!price || Number(price) <= 0) continue;

        const currency = (meta.currency || 'USD').toUpperCase();
        let priceInEur = Number(price);

        if (currency === 'USD') {
          priceInEur = priceInEur * usdToEurRate;
        } else if (currency === 'GBP' || currency === 'GBX' || currency === 'GBP') {
          priceInEur = (priceInEur / 100) * (usdToEurRate * 1.25);
        } else if (currency !== 'EUR') {
          priceInEur = priceInEur * usdToEurRate;
        }

        return {
          symbol: meta.symbol || sym,
          name: meta.shortName || meta.longName || sym,
          currency,
          nativePrice: Number(price),
          priceInEur: Number(priceInEur.toFixed(4)),
        };
      } catch {
        // Tentar próximo host ou candidato
      }
    }
  }

  throw new Error(`Cotação indisponível para ticker: ${ticker}`);
}

// 4. Fluxo Principal
async function runDailySnapshot() {
  console.log('🚀 A iniciar gravação do Snapshot Diário...');

  const usdToEurRate = await getUsdEurExchangeRate();

  // Ler todos os holdings de /portfolios/main/holdings
  console.log('📦 A ler posições em /portfolios/main/holdings...');
  const holdingsCol = db.collection('portfolios').doc('main').collection('holdings');
  const holdingsSnapshot = await holdingsCol.get();

  if (holdingsSnapshot.empty) {
    console.log('ℹ️ Nenhuma posição encontrada no portfólio. A terminar sem alterações.');
    return;
  }

  const holdings = [];
  holdingsSnapshot.forEach((docSnap) => {
    holdings.push({ id: docSnap.id, ...docSnap.data() });
  });

  console.log(`📋 Encontradas ${holdings.length} posições. A obter cotações em tempo real...`);

  let totalValueEur = 0;
  let totalInvestedEur = 0;
  const positionsDetails = [];

  for (const holding of holdings) {
    const ticker = holding.ticker || holding.id;
    const shares = Number(holding.shares || 0);

    if (shares <= 0) continue;

    let quote = null;
    try {
      quote = await fetchYahooQuote(ticker, usdToEurRate);
    } catch (err) {
      console.warn(`⚠️ Aviso: ${err.message}`);
    }

    const currentPriceEur = quote ? quote.priceInEur : 0;
    const positionValueEur = Number((shares * currentPriceEur).toFixed(2));

    // Calcular custo real de aquisição total considerando todos os aportes
    let holdingInvestedEur = 0;
    const purchases = Array.isArray(holding.purchases) ? holding.purchases : [];
    purchases.forEach((p) => {
      const pShares = Number(p.shares || 0);
      const pPrice = Number(p.priceEur ?? p.price ?? 0);
      if (pShares > 0 && pPrice > 0) {
        holdingInvestedEur += pShares * pPrice;
      }
    });

    // Se não tiver compras discriminadas com preço, usa o valor atual como base de custo neutra
    if (holdingInvestedEur === 0 && positionValueEur > 0) {
      holdingInvestedEur = positionValueEur;
    }

    totalValueEur += positionValueEur;
    totalInvestedEur += holdingInvestedEur;

    const diffEur = positionValueEur - holdingInvestedEur;
    const returnPct =
      holdingInvestedEur > 0 ? (diffEur / holdingInvestedEur) * 100 : 0;

    positionsDetails.push({
      ticker,
      name: quote?.name || ticker,
      shares,
      priceEur: currentPriceEur,
      nativePrice: quote?.nativePrice || 0,
      nativeCurrency: quote?.currency || 'EUR',
      valueEur: positionValueEur,
      investedEur: Number(holdingInvestedEur.toFixed(2)),
      diffEur: Number(diffEur.toFixed(2)),
      returnPercent: Number(returnPct.toFixed(2)),
    });

    console.log(
      `  • ${ticker}: ${shares} ações @ €${currentPriceEur.toFixed(2)} = €${positionValueEur.toFixed(2)} (Investido: €${holdingInvestedEur.toFixed(2)})`
    );
  }

  const overallDiffEur = totalValueEur - totalInvestedEur;
  const overallReturnPercent =
    totalInvestedEur > 0 ? (overallDiffEur / totalInvestedEur) * 100 : 0;

  // Formato da chave YYYY-MM-DD
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  const snapshotData = {
    date: dateKey,
    timestamp: Date.now(),
    totalValue: Number(totalValueEur.toFixed(2)),
    totalInvested: Number(totalInvestedEur.toFixed(2)),
    returnPercent: Number(overallReturnPercent.toFixed(2)),
    totalReturnPercent: Number(overallReturnPercent.toFixed(2)),
    diffEur: Number(overallDiffEur.toFixed(2)),
    positionsCount: positionsDetails.length,
    usdToEurRate: Number(usdToEurRate.toFixed(4)),
    positions: positionsDetails,
    updatedAt: new Date().toISOString(),
  };

  console.log('\n📊 Resumo do Snapshot Diário:');
  console.log(`  Data: ${dateKey}`);
  console.log(`  Valor de Mercado: €${snapshotData.totalValue.toLocaleString('de-DE')}`);
  console.log(`  Total Investido:  €${snapshotData.totalInvested.toLocaleString('de-DE')}`);
  console.log(
    `  Rentabilidade:   ${overallReturnPercent >= 0 ? '+' : ''}${snapshotData.totalReturnPercent.toFixed(2)}% (€${snapshotData.diffEur.toLocaleString('de-DE')})`
  );

  // Gravar no Firestore: /portfolios/main/dailySnapshots/{YYYY-MM-DD}
  const snapshotDocRef = db
    .collection('portfolios')
    .doc('main')
    .collection('dailySnapshots')
    .doc(dateKey);

  await snapshotDocRef.set(snapshotData, { merge: true });
  console.log(`\n🎉 Snapshot gravado com sucesso em /portfolios/main/dailySnapshots/${dateKey}!`);
}

runDailySnapshot()
  .then(() => {
    console.log('🏁 Processo terminado com sucesso.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Erro fatal durante a execução do snapshot:', err);
    process.exit(1);
  });
