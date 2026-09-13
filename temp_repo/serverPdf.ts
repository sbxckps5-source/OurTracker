import { PDFParse } from 'pdf-parse';

export interface ParsedPdfPosition {
  id: string;
  name: string;
  ticker: string;
  category: string;
  volume: number;
  value: number;
  profit: number;
  openPrice?: number;
  currentPrice?: number;
}

export interface ParsedPdfDeposit {
  id: string;
  date: string;
  amount: number;
  comment?: string;
}

export interface PdfParseResult {
  account?: string;
  currency: string;
  currencySymbol: string;
  deposits: ParsedPdfDeposit[];
  openPositions: ParsedPdfPosition[];
  summary: {
    totalDeposited: number;
    totalOpenValue: number;
    totalProfit: number;
    openPositionsCount: number;
  };
  detectedBroker?: string;
  rawTextPreview: string;
}

export async function parsePortfolioPdf(buffer: Buffer): Promise<PdfParseResult> {
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  const fullText = textResult.text || '';
  const lines = fullText.split(/[\r\n\t]+/).map((l) => l.trim()).filter((l) => l.length > 0);

  // 1. Currency Detection
  let detectedCurrency = 'EUR';
  let currencySymbol = '€';

  const currencyRegex = /\b(EUR|USD|GBP|CHF|JPY|CAD|AUD)\b/gi;
  const currencyFreq: Record<string, number> = { EUR: 0, USD: 0, GBP: 0, CHF: 0 };

  let match: RegExpExecArray | null;
  while ((match = currencyRegex.exec(fullText)) !== null) {
    const cur = match[1].toUpperCase();
    currencyFreq[cur] = (currencyFreq[cur] || 0) + 1;
  }

  // Count symbols
  if (fullText.includes('€')) currencyFreq.EUR = (currencyFreq.EUR || 0) + 5;
  if (fullText.includes('$')) currencyFreq.USD = (currencyFreq.USD || 0) + 5;
  if (fullText.includes('£')) currencyFreq.GBP = (currencyFreq.GBP || 0) + 5;

  // Look for explicit currency headers: "Currency EUR" or "Amount Currency: USD"
  const explicitCurMatch = fullText.match(/(?:Currency|Moeda|Devise|Währung)[\s:]*([A-Z]{3})/i);
  if (explicitCurMatch && explicitCurMatch[1]) {
    const cur = explicitCurMatch[1].toUpperCase();
    currencyFreq[cur] = (currencyFreq[cur] || 0) + 10;
  }

  let maxCount = -1;
  for (const [cur, count] of Object.entries(currencyFreq)) {
    if (count > maxCount && count > 0) {
      maxCount = count;
      detectedCurrency = cur;
    }
  }

  if (detectedCurrency === 'USD') currencySymbol = '$';
  else if (detectedCurrency === 'GBP') currencySymbol = '£';
  else if (detectedCurrency === 'CHF') currencySymbol = 'CHF ';
  else if (detectedCurrency === 'JPY') currencySymbol = '¥';
  else currencySymbol = '€';

  // 2. Account Number Detection
  let account: string | undefined;
  const accountMatch = fullText.match(/(?:Account\s*(?:number|id)?|Conta|Nº\s*Conta)[\s:]*([0-9A-Za-z_-]{5,20})/i);
  if (accountMatch) {
    account = accountMatch[1];
  }

  // 3. Deposit Extraction
  const deposits: ParsedPdfDeposit[] = [];
  const depositKeywords = ['deposit', 'depósito', 'deposito', 'deposição', 'bridger_pay'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    
    // Must be a deposit line, but not a header or disclaimer
    if (depositKeywords.some((kw) => lower.includes(kw)) && !lower.includes('cash operations') && !lower.includes('folha:')) {
      // Find date
      const dateMatch = line.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)?|[0-9]{2}\/[0-9]{2}\/[0-9]{4}|[0-9]{2}-[0-9]{2}-[0-9]{4})/);
      let dateStr = '';
      let validAmount: number | undefined;

      if (dateMatch && dateMatch.index !== undefined) {
        const rawDateOnly = dateMatch[0].split(/[\sT]/)[0];
        if (rawDateOnly.includes('-')) {
          const parts = rawDateOnly.split('-');
          if (parts[0].length === 4) {
            dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
          } else {
            dateStr = rawDateOnly;
          }
        } else {
          dateStr = rawDateOnly;
        }

        // The amount often follows directly after the date
        const afterDate = line.slice(dateMatch.index + dateMatch[0].length).trim();
        const firstToken = afterDate.split(/\s+/)[0];
        const parsedToken = parseFloat(firstToken.replace(',', '.'));
        if (!isNaN(parsedToken) && parsedToken > 0 && parsedToken < 10000000) {
          validAmount = parsedToken;
        }
      }

      if (!validAmount) {
        // Fallback: look for numeric currency amount
        const numbers = line.match(/(?:^|\s)([0-9]{1,6}(?:[.,][0-9]{1,2})?)(?=\s|$)/g);
        if (numbers) {
          const cleanNums = numbers
            .map((n) => parseFloat(n.trim().replace(',', '.')))
            .filter((n) => !isNaN(n) && n > 0 && n < 10000000);
          validAmount = cleanNums.find((n) => n >= 1);
        }
      }

      if (validAmount && validAmount > 0) {
        deposits.push({
          id: `dep-${deposits.length + 1}`,
          date: dateStr || new Date().toISOString().slice(0, 10),
          amount: validAmount,
          comment: line.slice(0, 80),
        });
      }
    }
  }

  // 4. Open Positions Extraction
  const openPositions: ParsedPdfPosition[] = [];
  
  // Also check if summary is present
  let summaryValue = 0;
  let summaryProfit = 0;
  const summaryValMatch = fullText.match(/Open position value\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (summaryValMatch) summaryValue = parseFloat(summaryValMatch[1]);
  const summaryProfMatch = fullText.match(/Open position profit\s*([+-]?[0-9]+(?:\.[0-9]+)?)/i);
  if (summaryProfMatch) summaryProfit = parseFloat(summaryProfMatch[1]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Skip headers and irrelevant lines
    if (
      lower.includes('folha: closed') ||
      lower.includes('folha: cash') ||
      lower.includes('open positions') ||
      lower.includes('metric') ||
      lower.includes('investment plans') ||
      lower.includes('note summary') ||
      lower.includes('profit/loss -') ||
      lower.includes('stop loss')
    ) {
      continue;
    }

    // Skip sub-rows of individual BUY orders
    if (/\b(BUY|SELL)\b/i.test(line)) {
      continue;
    }

    // Check for Category (ETF, STOCK, ETC, CRYPTO, EQUITY, FUND, AÇÃO, ACAO)
    const catMatch = line.match(/\b(ETF|STOCK|ETC|CRYPTO|EQUITY|FUND|AÇÃO|ACAO)\b/i);
    if (catMatch && catMatch.index !== undefined) {
      const category = catMatch[1].toUpperCase();
      const catIdx = catMatch.index;

      const beforeCat = line.slice(0, catIdx).trim();
      const afterCat = line.slice(catIdx + category.length).trim();

      const beforeTokens = beforeCat.split(/\s+/).filter(Boolean);
      if (beforeTokens.length === 0) continue;

      // The raw ticker is the last token before category (e.g., SXR8.DE, VVSM.DE, SPCX.US, etc.)
      const rawTicker = beforeTokens[beforeTokens.length - 1];
      const cleanTicker = rawTicker.replace(/\.US$/i, '');

      // Clean the instrument name
      let name = beforeTokens.slice(0, -1).join(' ');
      name = name
        .replace(/^My Trades\s*/i, '')
        .replace(/^Invest\s*/i, '')
        .replace(/^Trades\s*/i, '')
        .trim();

      if (!name) name = cleanTicker;

      // Parse numbers from afterCat
      // Typically: Volume, Value, [Current Price], [Open Price], [Net Profit %], [Net Profit], [Gross Profit]
      const numTokens = afterCat
        .split(/\s+/)
        .map((t) => parseFloat(t.replace(',', '.')))
        .filter((n) => !isNaN(n));

      if (numTokens.length >= 2) {
        const volume = numTokens[0];
        const value = numTokens[1];
        
        let profit = 0;
        let openPrice: number | undefined;
        let currentPrice: number | undefined;

        if (numTokens.length >= 3) {
          openPrice = numTokens[2];
        }
        if (numTokens.length >= 4) {
          currentPrice = numTokens[3];
        }
        if (numTokens.length >= 5) {
          profit = numTokens[numTokens.length - 1];
        }

        // Validate volume and value
        if (volume > 0 && value > 0) {
          openPositions.push({
            id: `pos-${openPositions.length + 1}`,
            name,
            ticker: cleanTicker,
            category: category === 'STOCK' ? 'Ação' : category,
            volume,
            value,
            profit,
            openPrice,
            currentPrice,
          });
        }
      }
    } else {
      // Generic fallback: check if line has format: [Ticker] [Name...] [Volume] [Value]
      const genericMatch = line.match(/^([A-Z0-9.]{2,10})\s+([A-Za-z0-9\s&.-]+?)\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)(?:\s+([+-]?[0-9]+(?:\.[0-9]+)?))?$/);
      if (genericMatch) {
        const rawTicker = genericMatch[1];
        const ticker = rawTicker.replace(/\.US$/i, '');
        const name = genericMatch[2].trim();
        const volume = parseFloat(genericMatch[3]);
        const value = parseFloat(genericMatch[4]);
        const profit = genericMatch[5] ? parseFloat(genericMatch[5]) : 0;

        if (volume > 0 && value > 0 && !['TOTAL', 'SUBTOTAL', 'ACCOUNT'].includes(ticker)) {
          openPositions.push({
            id: `pos-${openPositions.length + 1}`,
            name,
            ticker,
            category: 'Ativo',
            volume,
            value,
            profit,
          });
        }
      }
    }
  }

  // Calculate totals
  const totalDeposited = Number(deposits.reduce((acc, d) => acc + d.amount, 0).toFixed(2));
  const calculatedValue = Number(openPositions.reduce((acc, p) => acc + p.value, 0).toFixed(2));
  const calculatedProfit = Number(openPositions.reduce((acc, p) => acc + p.profit, 0).toFixed(2));

  const totalOpenValue = summaryValue > 0 ? summaryValue : calculatedValue;
  const totalProfit = summaryProfit !== 0 ? summaryProfit : calculatedProfit;

  return {
    account,
    currency: detectedCurrency,
    currencySymbol,
    deposits,
    openPositions,
    summary: {
      totalDeposited,
      totalOpenValue,
      totalProfit,
      openPositionsCount: openPositions.length,
    },
    rawTextPreview: fullText.slice(0, 500),
  };
}
