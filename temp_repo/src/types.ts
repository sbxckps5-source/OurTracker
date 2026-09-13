export interface PurchaseRecord {
  id?: string;
  date: number; // timestamp in ms
  shares: number;
  price?: number;
  priceEur?: number;
}

export interface HoldingDoc {
  id: string;
  ticker: string;
  shares: number;
  createdAt: number;
  color?: string;
  purchases?: PurchaseRecord[];
}

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number; // in EUR
  nativePrice: number; // in native currency (e.g. USD)
  nativeCurrency: string; // e.g. "USD", "EUR"
  fxRateToEur: number;
  value: number; // total position value in EUR
  allocationPercent: number;
  changePercent?: number;
  monthReturnPercent?: number;
  color: string;
  isError?: boolean;
  errorMessage?: string;
}

export interface PortfolioSummary {
  totalValue: number;
  currencySymbol: string;
  positionsCount: number;
  positions: PortfolioPosition[];
}

export interface PdfPortfolioPosition {
  id: string;
  name: string;
  ticker: string;
  category: string;
  volume: number;
  value: number;
  profit: number;
  openPrice?: number;
  currentPrice?: number;
  openDate?: string;
  isConfirmed?: boolean;
}

export interface PdfDepositItem {
  id: string;
  date: string;
  amount: number;
  comment?: string;
}

export interface PdfParseResponse {
  account?: string;
  currency: string;
  currencySymbol: string;
  deposits: PdfDepositItem[];
  openPositions: PdfPortfolioPosition[];
  summary: {
    totalDeposited: number;
    totalOpenValue: number;
    totalProfit: number;
    openPositionsCount: number;
  };
  rawTextPreview?: string;
}

export type TabType = 'home' | 'allocation' | 'settings';

