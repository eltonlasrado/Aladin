// ─── API Layer (client-side via CORS proxy) ──────────────────────────────
// Uses corsproxy.io and allorigins as fallbacks to reach NSE/BSE public APIs

const CORS1 = 'https://corsproxy.io/?';
const CORS2 = 'https://api.allorigins.win/raw?url=';
const NSE   = 'https://www.nseindia.com';
const YF    = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
const YFC   = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.nseindia.com/',
  'X-Requested-With': 'XMLHttpRequest',
};

async function fetchJson(url, opts = {}) {
  for (const proxy of [CORS1, CORS2]) {
    try {
      const full = proxy + encodeURIComponent(url);
      const r = await fetch(full, { signal: AbortSignal.timeout(8000), ...opts });
      if (r.ok) return r.json();
    } catch { /* try next */ }
  }
  return null;
}

async function nseGet(path) {
  return fetchJson(NSE + path, { headers: NSE_HEADERS });
}

// ─── Market Data (indices + VIX + FII/DII) ──────────────────────────────
export async function fetchMarketData() {
  try {
    const [idxRes, fiiRes, statusRes, vixRes] = await Promise.allSettled([
      nseGet('/api/allIndices'),
      nseGet('/api/fiidiiTradeReact'),
      nseGet('/api/marketStatus'),
      nseGet('/api/allIndices'), // VIX is in allIndices
    ]);

    let allIndices = [];
    if (idxRes.status === 'fulfilled' && idxRes.value?.data) {
      allIndices = idxRes.value.data;
    }

    const vixEntry = allIndices.find(i => i.index === 'India VIX' || i.indexSymbol === 'INDIAVIX');
    const indiaVix = vixEntry?.last ?? null;

    const indexMap = {
      NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', FINNIFTY: 'NIFTY FIN SERVICE',
      MIDCPNIFTY: 'NIFTY MIDCAP SELECT', SENSEX: 'S&P BSE SENSEX', BANKEX: 'S&P BSE BANKEX',
      NIFTY100: 'NIFTY 100', NIFTY200: 'NIFTY 200', NIFTY500: 'NIFTY 500',
      NIFTYNXT50: 'NIFTY NEXT 50', NIFTYIT: 'NIFTY IT', NIFTYPHARMA: 'NIFTY PHARMA',
      NIFTYAUTO: 'NIFTY AUTO', NIFTYMETAL: 'NIFTY METAL', NIFTYREALTY: 'NIFTY REALTY',
      NIFTYFMCG: 'NIFTY FMCG', NIFTYINFRA: 'NIFTY INFRA', NIFTYENERGY: 'NIFTY ENERGY',
    };

    const indexData = {};
    Object.entries(indexMap).forEach(([sym, nseKey]) => {
      const found = allIndices.find(i => i.index === nseKey || i.indexSymbol?.includes(sym));
      if (found) indexData[sym] = { last: found.last, change: found.variation, pChange: found.percentChange,
        open: found.open, high: found.high, low: found.low, previousClose: found.previousClose,
        yearHigh: found.yearHigh, yearLow: found.yearLow };
    });

    let fiiDii = [];
    if (fiiRes.status === 'fulfilled' && Array.isArray(fiiRes.value)) {
      const dateMap = {};
      for (const row of fiiRes.value) {
        if (!dateMap[row.date]) dateMap[row.date] = {};
        if (row.clientType === 'FII/FPI') dateMap[row.date].fii = row;
        if (row.clientType === 'DII') dateMap[row.date].dii = row;
      }
      fiiDii = Object.entries(dateMap).slice(0, 10).map(([date, { fii, dii }]) => ({
        date,
        fiiBuy: fii?.buyValue ?? 0, fiiSell: fii?.sellValue ?? 0, fiiNet: fii?.netValue ?? 0,
        diiBuy: dii?.buyValue ?? 0, diiSell: dii?.sellValue ?? 0, diiNet: dii?.netValue ?? 0,
      }));
    }

    let marketStatus = null;
    if (statusRes.status === 'fulfilled') {
      marketStatus = statusRes.value?.marketState?.[0] ?? null;
    }

    return { ok: true, indiaVix, indexData, allIndices, fiiDii, marketStatus };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Yahoo Finance quotes (fallback / stocks) ────────────────────────────
const YF_SYMBOL_MAP = {
  NIFTY:'^NSEI', BANKNIFTY:'^NSEBANK', FINNIFTY:'NIFTY_FIN_SERVICE.NS',
  MIDCPNIFTY:'NIFTYMIDCAP50.NS', SENSEX:'^BSESN', BANKEX:'BANKEX.BO',
  RELIANCE:'RELIANCE.NS', TCS:'TCS.NS', HDFCBANK:'HDFCBANK.NS',
  INFY:'INFY.NS', ICICIBANK:'ICICIBANK.NS', SBIN:'SBIN.NS',
  BHARTIARTL:'BHARTIARTL.NS', ITC:'ITC.NS', KOTAKBANK:'KOTAKBANK.NS',
  LT:'LT.NS', AXISBANK:'AXISBANK.NS', WIPRO:'WIPRO.NS', ONGC:'ONGC.NS',
  TATAMOTORS:'TATAMOTORS.NS', HCLTECH:'HCLTECH.NS', ZOMATO:'ZOMATO.NS',
  PAYTM:'PAYTM.NS', MARUTI:'MARUTI.NS', SUNPHARMA:'SUNPHARMA.NS',
  TITAN:'TITAN.NS', BAJFINANCE:'BAJFINANCE.NS', NTPC:'NTPC.NS',
  TATASTEEL:'TATASTEEL.NS', HINDALCO:'HINDALCO.NS', JSWSTEEL:'JSWSTEEL.NS',
  ADANIENT:'ADANIENT.NS', ADANIPORTS:'ADANIPORTS.NS', DLF:'DLF.NS',
  CIPLA:'CIPLA.NS', DRREDDY:'DRREDDY.NS', HAL:'HAL.NS', IRCTC:'IRCTC.NS',
};

export async function fetchYFQuotes(symbols) {
  const yfSyms = symbols.map(s => YF_SYMBOL_MAP[s] || `${s}.NS`).join(',');
  const url = YF + yfSyms + '&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow';
  const data = await fetchJson(url);
  if (!data?.quoteResponse?.result) return {};
  const map = {};
  data.quoteResponse.result.forEach((q, i) => {
    const id = symbols[i];
    if (!id) return;
    map[id] = {
      cur: q.regularMarketPrice || 0, open: q.regularMarketOpen || 0,
      high: q.regularMarketDayHigh || 0, low: q.regularMarketDayLow || 0,
      prev: q.regularMarketPreviousClose || 0,
      chg: q.regularMarketChange || 0, pct: q.regularMarketChangePercent || 0,
      vol: q.regularMarketVolume || 0,
      w52h: q.fiftyTwoWeekHigh || 0, w52l: q.fiftyTwoWeekLow || 0, live: true,
    };
  });
  return map;
}

export async function fetchYFChart(symbol) {
  const yfSym = YF_SYMBOL_MAP[symbol] || `${symbol}.NS`;
  const url = `${YFC}${yfSym}?interval=1m&range=1d`;
  const data = await fetchJson(url);
  if (!data?.chart?.result?.[0]) return null;
  const r = data.chart.result[0];
  const ts = r.timestamp || [], q = r.indicators?.quote?.[0] || {};
  return ts.map((t, i) => ({
    time: t * 1000, open: q.open?.[i], close: q.close?.[i],
    high: q.high?.[i], low: q.low?.[i], vol: q.volume?.[i],
  })).filter(x => x.open && x.close && x.high && x.low);
}

// ─── NSE Option Chain ────────────────────────────────────────────────────
export async function fetchNSEOptionChain(symbol, expiry = '') {
  const isIndex = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX','BANKEX'].includes(symbol);
  const path = isIndex
    ? `/api/option-chain-indices?symbol=${symbol}`
    : `/api/option-chain-equities?symbol=${symbol}`;
  const raw = await nseGet(path);
  if (!raw?.records?.data) return null;
  return raw;
}

// ─── NSE News / Corporate Announcements ─────────────────────────────────
export async function fetchNSENews(symbol = '') {
  const items = [];
  try {
    const path = symbol && !['NIFTY','BANKNIFTY','FINNIFTY'].includes(symbol)
      ? `/api/quote-equity?symbol=${symbol}&section=announcements`
      : '/api/corporatecalendar';
    const res = await nseGet(path);
    (res?.data || []).slice(0, 12).forEach(a => {
      const title = (a.subject || a.desc || '').substring(0, 150);
      if (title) items.push({
        title, summary: (a.desc || title).substring(0, 300),
        source: 'NSE', time: a.an_dt || new Date().toISOString(),
        symbol: a.symbol, category: 'announcement',
        sentiment: detectSentiment(title),
      });
    });
  } catch { /* ignore */ }

  // Top gainers/losers
  try {
    const g = await nseGet('/api/live-analysis-variations?index=gainers&type=securities&category=FO');
    const top = (g?.data || []).slice(0, 5);
    if (top.length) items.push({
      title: `F&O Top Gainers: ${top.map(s => `${s.symbol} (+${s.pChange?.toFixed(1)}%)`).join(', ')}`,
      summary: top.map(s => `${s.symbol} @ ₹${s.lastPrice} (+${s.pChange?.toFixed(2)}%)`).join('; '),
      source: 'NSE Live', time: new Date().toISOString(), category: 'market', sentiment: 'positive',
    });
  } catch { /* ignore */ }

  try {
    const l = await nseGet('/api/live-analysis-variations?index=loosers&type=securities&category=FO');
    const top = (l?.data || []).slice(0, 5);
    if (top.length) items.push({
      title: `F&O Top Losers: ${top.map(s => `${s.symbol} (${s.pChange?.toFixed(1)}%)`).join(', ')}`,
      summary: top.map(s => `${s.symbol} @ ₹${s.lastPrice} (${s.pChange?.toFixed(2)}%)`).join('; '),
      source: 'NSE Live', time: new Date().toISOString(), category: 'market', sentiment: 'negative',
    });
  } catch { /* ignore */ }

  return items.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function detectSentiment(text) {
  const pos = ['gain','rise','rally','surge','growth','profit','beat','record','high','up','positive','strong','upgrade','buy','dividend','bonus'];
  const neg = ['fall','drop','decline','loss','miss','low','down','negative','weak','downgrade','sell','concern','risk','bearish','warning'];
  const l = (text || '').toLowerCase();
  const ps = pos.filter(w => l.includes(w)).length;
  const ns = neg.filter(w => l.includes(w)).length;
  return ps > ns ? 'positive' : ns > ps ? 'negative' : 'neutral';
}

// ─── ET Markets RSS (additional news source) ─────────────────────────────
export async function fetchRSSNews() {
  const feeds = [
    'https://economictimes.indiatimes.com/markets/rss.cms',
    'https://feeds.feedburner.com/ndtvprofit-latest',
  ];
  const items = [];
  for (const feed of feeds) {
    try {
      const data = await fetchJson(feed);
      const xml = typeof data === 'string' ? data : data?.contents || '';
      if (!xml) continue;
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      doc.querySelectorAll('item').forEach((item, idx) => {
        if (idx >= 5) return;
        const title = item.querySelector('title')?.textContent?.trim() || '';
        if (title) items.push({
          title, source: feed.includes('economictimes') ? 'ET Markets' : 'NDTV Profit',
          time: item.querySelector('pubDate')?.textContent || '',
          sentiment: detectSentiment(title), category: 'macro',
        });
      });
    } catch { /* ignore */ }
  }
  return items;
}
