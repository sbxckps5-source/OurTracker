/**
 * scripts/backfillSnapshots.mjs
 *
 * Script de migração único (executado uma vez) que reconstrói retroativamente
 * o histórico diário do portfólio desde 1 mês antes da primeira compra até hoje,
 * gravando em /portfolios/main/dailySnapshots/{YYYY-MM-DD}.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// 1. Inicializar Firebase Admin SDK com parser tolerante a falhas
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
  console.error('Execute: FIREBASE_SERVICE_ACCOUNT_KEY=\'<conteúdo_json>\' node scripts/backfillSnapshots.mjs');
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
  projectId: serviceAccount.project_id || 'gen-lang-client-0800917980',
});

// A base de dados do Firestore (por defeito usa a nativa gratuita '(default)')
const TARGET_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  process.env.FIREBASE_DATABASE_ID ||
  '(default)';

const db = TARGET_DATABASE_ID && TARGET_DATABASE_ID !== '(default)'
  ? getFirestore(app, TARGET_DATABASE_ID)
  : getFirestore(app);


// Formatador YYYY-MM-DD (UTC)
function toIsoDate(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 2. Obter taxas de câmbio históricas USD/EUR da Frankfurter para o intervalo
async function fetchHistoricalFxRates(startDateStr, endDateStr) {
  console.log(`💱 A obter taxas de câmbio históricas USD/EUR (${startDateStr} a ${endDateStr})...`);
  const ratesMap = new Map();

  try {
    const url = `https://api.frankfurter.dev/v1/${startDateStr}..${endDateStr}?base=USD&symbols=EUR`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates) {
        for (const [dStr, rObj] of Object.entries(data.rates)) {
          if (rObj?.EUR) {
            ratesMap.set(dStr, Number(rObj.EUR));
          }
        }
        console.log(`✅ Obtidas ${ratesMap.size} taxas cambiais da Frankfurter.`);
      }
    }
  } catch (err) {
    console.warn('⚠️ Aviso: Falha ao obter intervalo contínuo da Frankfurter:', err.message);
  }

  // Se a Frankfurter não devolveu nada (ou deu erro), fallback para taxa média
  if (ratesMap.size === 0) {
    console.warn('⚠️ A usar taxa cambial fixa de 0.92 como contingência.');
  }

  return ratesMap;
}

// 3. Obter histórico de preços diários da Yahoo Finance para um ticker
async function fetchYahooHistoricalPrices(ticker, startTimestampSec, endTimestampSec) {
  const cleanTicker = ticker.trim().toUpperCase();
  const candidates = [];
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
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
          sym
        )}?period1=${startTimestampSec}&period2=${endTimestampSec}&interval=1d`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;

        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (!result) continue;

        const meta = result.meta;
        const currency = (meta.currency || 'USD').toUpperCase();
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];

        const priceByDate = new Map();
        for (let i = 0; i < timestamps.length; i++) {
          const t = timestamps[i];
          const price = closes[i];
          if (t && price !== null && price !== undefined && !isNaN(price) && price > 0) {
            const dateStr = toIsoDate(new Date(t * 1000));
            priceByDate.set(dateStr, Number(price));
          }
        }

        if (priceByDate.size > 0) {
          console.log(`  📈 ${sym}: ${priceByDate.size} preços históricos carregados (${currency})`);
          return {
            symbol: sym,
            currency,
            priceByDate,
            lastPrice: meta.regularMarketPrice ?? meta.chartPreviousClose ?? 0,
          };
        }
      } catch {
        // Tentar próximo host
      }
    }
  }

  console.warn(`  ⚠️ Não foi possível obter histórico para ${ticker}`);
  return null;
}

async function runBackfill() {
  console.log('🚀 A iniciar migração retroativa de Snapshots Diários...');

  // 1. Ler todos os holdings
  console.log('📦 A ler posições em /portfolios/main/holdings...');
  const holdingsCol = db.collection('portfolios').doc('main').collection('holdings');
  const holdingsSnap = await holdingsCol.get();

  if (holdingsSnap.empty) {
    console.log('ℹ️ Nenhuma posição encontrada. Nada para retroagir.');
    return;
  }

  const holdings = [];
  let earliestPurchaseTime = Infinity;

  holdingsSnap.forEach((docSnap) => {
    const data = docSnap.id ? { id: docSnap.id, ...docSnap.data() } : docSnap.data();
    holdings.push(data);

    // Analisar compras
    const purchases = Array.isArray(data.purchases) ? data.purchases : [];
    purchases.forEach((p) => {
      const pDate = typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || 0);
      if (pDate > 0 && pDate < earliestPurchaseTime) {
        earliestPurchaseTime = pDate;
      }
    });

    const created = Number(data.createdAt || 0);
    if (created > 0 && created < earliestPurchaseTime) {
      earliestPurchaseTime = created;
    }
  });

  const now = new Date();
  const todayTime = now.getTime();

  // Se não foi encontrada nenhuma data, usar 30 dias atrás
  if (earliestPurchaseTime === Infinity || earliestPurchaseTime > todayTime) {
    console.log('ℹ️ Nenhuma data de compra anterior encontrada. A assumir 30 dias atrás.');
    earliestPurchaseTime = todayTime - 30 * 24 * 60 * 60 * 1000;
  }

  // Início: 1 mês (30 dias) antes da primeira compra registada
  const startDateObj = new Date(earliestPurchaseTime);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - 30);
  startDateObj.setUTCHours(0, 0, 0, 0);

  const startTimestampSec = Math.floor(startDateObj.getTime() / 1000);
  const endTimestampSec = Math.floor(todayTime / 1000) + 86400;

  const startDateStr = toIsoDate(startDateObj);
  const todayDateStr = toIsoDate(now);

  console.log(`📅 Primeira compra detectada: ${toIsoDate(new Date(earliestPurchaseTime))}`);
  console.log(`📅 Período de retroação: de ${startDateStr} até hoje (${todayDateStr})`);

  // 2. Descarregar cotações históricas para cada holding
  console.log('\n📊 A descarregar cotações históricas da Yahoo Finance...');
  const tickerHistoryMap = new Map();
  for (const h of holdings) {
    const ticker = h.ticker || h.id;
    const history = await fetchYahooHistoricalPrices(ticker, startTimestampSec, endTimestampSec);
    if (history) {
      tickerHistoryMap.set(ticker, history);
    }
  }

  // 3. Descarregar taxas de câmbio para o intervalo
  const fxRatesMap = await fetchHistoricalFxRates(startDateStr, todayDateStr);

  // 4. Gerar os dias do intervalo e calcular os snapshots
  console.log('\n🧮 A calcular snapshots diários...');
  const currentStepDate = new Date(startDateObj);
  const dailySnapshots = [];

  let lastKnownFx = 0.92;
  const lastKnownPrices = new Map();

  while (currentStepDate <= now) {
    const dateStr = toIsoDate(currentStepDate);
    const dayEndTimestamp = new Date(currentStepDate).setUTCHours(23, 59, 59, 999);
    const noonTimestamp = new Date(currentStepDate).setUTCHours(12, 0, 0, 0);

    // Câmbio para o dia (ou forward fill)
    if (fxRatesMap.has(dateStr)) {
      lastKnownFx = fxRatesMap.get(dateStr);
    }
    const dayFx = lastKnownFx;

    let dayTotalValueEur = 0;
    let dayTotalInvestedEur = 0;
    let activePositionsCount = 0;
    const dayPositions = [];

    for (const h of holdings) {
      const ticker = h.ticker || h.id;
      const history = tickerHistoryMap.get(ticker);

      // Calcular ações detidas até ao final deste dia
      let sharesHeld = 0;
      let investedInHolding = 0;

      const purchases = Array.isArray(h.purchases) ? h.purchases : [];
      if (purchases.length > 0) {
        purchases.forEach((p) => {
          const pDate = typeof p.date === 'string' ? new Date(p.date).getTime() : Number(p.date || 0);
          if (pDate <= dayEndTimestamp) {
            const s = Number(p.shares || 0);
            const price = Number(p.priceEur ?? p.price ?? 0);
            if (s > 0) {
              sharesHeld += s;
              if (price > 0) {
                investedInHolding += s * price;
              }
            }
          }
        });
      } else {
        // Sem histórico discriminado de compras: se criado antes deste dia, assume a quantidade atual
        const created = Number(h.createdAt || 0);
        if (created <= dayEndTimestamp) {
          sharesHeld = Number(h.shares || 0);
        }
      }

      // Se ainda não tinha ações deste ativo neste dia, salta
      if (sharesHeld <= 0) continue;

      // Obter preço para este dia (ou carregar forward de dias anteriores)
      if (history) {
        if (history.priceByDate.has(dateStr)) {
          lastKnownPrices.set(ticker, history.priceByDate.get(dateStr));
        }
      }

      let nativePrice = lastKnownPrices.get(ticker) || (history ? history.lastPrice : 0) || 0;
      const currency = history ? history.currency : 'EUR';

      let priceInEur = nativePrice;
      if (currency === 'USD') {
        priceInEur = priceInEur * dayFx;
      } else if (currency === 'GBP' || currency === 'GBX') {
        priceInEur = (priceInEur / 100) * (dayFx * 1.25);
      } else if (currency !== 'EUR') {
        priceInEur = priceInEur * dayFx;
      }

      const valEur = Number((sharesHeld * priceInEur).toFixed(2));
      if (investedInHolding === 0 && valEur > 0) {
        investedInHolding = valEur;
      }

      dayTotalValueEur += valEur;
      dayTotalInvestedEur += investedInHolding;
      activePositionsCount++;

      dayPositions.push({
        ticker,
        shares: sharesHeld,
        priceEur: Number(priceInEur.toFixed(2)),
        valueEur: valEur,
        investedEur: Number(investedInHolding.toFixed(2)),
      });
    }

    const diffEur = dayTotalValueEur - dayTotalInvestedEur;
    const returnPercent =
      dayTotalInvestedEur > 0 ? (diffEur / dayTotalInvestedEur) * 100 : 0;

    dailySnapshots.push({
      date: dateStr,
      timestamp: noonTimestamp,
      totalValue: Number(dayTotalValueEur.toFixed(2)),
      totalInvested: Number(dayTotalInvestedEur.toFixed(2)),
      returnPercent: Number(returnPercent.toFixed(2)),
      totalReturnPercent: Number(returnPercent.toFixed(2)),
      diffEur: Number(diffEur.toFixed(2)),
      positionsCount: activePositionsCount,
      usdToEurRate: Number(dayFx.toFixed(4)),
    });

    // Avançar 1 dia
    currentStepDate.setUTCDate(currentStepDate.getUTCDate() + 1);
  }

  console.log(`✅ Calculados ${dailySnapshots.length} dias de histórico.`);

  // 5. Gravar em lotes (batch) no Firestore em /portfolios/main/dailySnapshots/{YYYY-MM-DD}
  console.log('💾 A gravar snapshots no Firestore...');
  const BATCH_SIZE = 400;
  for (let i = 0; i < dailySnapshots.length; i += BATCH_SIZE) {
    const chunk = dailySnapshots.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const snap of chunk) {
      const docRef = db.collection('portfolios').doc('main').collection('dailySnapshots').doc(snap.date);
      batch.set(docRef, snap, { merge: true });
    }

    await batch.commit();
    console.log(`  Gravados ${Math.min(i + BATCH_SIZE, dailySnapshots.length)}/${dailySnapshots.length} dias...`);
  }

  console.log('\n🎉 Migração retroativa concluída com sucesso!');
  console.log(`Último snapshot gravado (${dailySnapshots[dailySnapshots.length - 1]?.date}):`);
  console.log(`  Valor: €${dailySnapshots[dailySnapshots.length - 1]?.totalValue}`);
  console.log(`  Retorno: ${dailySnapshots[dailySnapshots.length - 1]?.returnPercent}%`);
}

runBackfill()
  .then(() => {
    console.log('🏁 Processo terminado com sucesso.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Erro fatal na migração:', err);
    process.exit(1);
  });
