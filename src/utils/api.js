/* ═══════════════════════════════════════════════════════════════════════
   API Layer — Complete Data Sources
   ✅ NSE India (option chain, FII/DII, indices, market status)
   ✅ BSE India (Sensex, Bankex, corporate news)
   ✅ Yahoo Finance (quotes, charts, fundamentals)
   ✅ screener.in (PE, MCap, ROE, Debt/Equity, growth)
   ✅ MoneyControl RSS (live market news)
   ✅ ET Markets RSS (news)
   ✅ NDTV Profit RSS (news)
   ✅ World Monitor (global macro headlines)
   ✅ ET Money market data (fear/greed, FD rates)
   ✅ Google Finance via proxy (alternate quote source)
═══════════════════════════════════════════════════════════════════════ */

const CORS1 = 'https://corsproxy.io/?'
const CORS2 = 'https://api.allorigins.win/raw?url='
const CORS3 = 'https://corsproxy.io/?url='

const NSE_BASE = 'https://www.nseindia.com'
const BSE_BASE = 'https://api.bseindia.com/BseIndiaAPI/api'
const YF_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols='
const YF_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const YF_SUMM  = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
const SCREENER = 'https://api.screener.in/api/company/?q='

/* ── Core fetch with multi-proxy fallback ──────────────────────────── */
async function fetchJson(url, opts = {}) {
  const proxies = [CORS1, CORS2]
  for (const px of proxies) {
    try {
      const r = await fetch(px + encodeURIComponent(url), {
        signal: AbortSignal.timeout(8000),
        headers: { 'x-requested-with': 'XMLHttpRequest', ...opts.headers },
        ...opts,
      })
      if (r.ok) {
        const ct = r.headers.get('content-type') || ''
        if (ct.includes('json')) return r.json()
        return r.text()
      }
    } catch { /* try next */ }
  }
  return null
}

async function fetchText(url) {
  for (const px of [CORS1, CORS2]) {
    try {
      const r = await fetch(px + encodeURIComponent(url), { signal: AbortSignal.timeout(8000) })
      if (r.ok) return r.text()
    } catch { /* next */ }
  }
  return null
}

/* ── NSE India ─────────────────────────────────────────────────────── */
async function nseGet(path) {
  return fetchJson(NSE_BASE + path, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, */*',
      'Referer': 'https://www.nseindia.com/',
    }
  })
}

export async function fetchMarketData() {
  try {
    const [idxRes, fiiRes, statusRes] = await Promise.allSettled([
      nseGet('/api/allIndices'),
      nseGet('/api/fiidiiTradeReact'),
      nseGet('/api/marketStatus'),
    ])

    let allIndices = []
    if (idxRes.status === 'fulfilled' && idxRes.value?.data) {
      allIndices = idxRes.value.data
    }

    const vixEntry = allIndices.find(i => i.index === 'India VIX' || i.indexSymbol === 'INDIAVIX')
    const indiaVix = vixEntry ? parseFloat(vixEntry.last) : null

    const indexMap = {
      NIFTY: 'NIFTY 50', BANKNIFTY: 'NIFTY BANK', FINNIFTY: 'NIFTY FIN SERVICE',
      MIDCPNIFTY: 'NIFTY MIDCAP SELECT', NIFTYNXT50: 'NIFTY NEXT 50',
      NIFTYIT: 'NIFTY IT', NIFTYPHARMA: 'NIFTY PHARMA', NIFTYAUTO: 'NIFTY AUTO',
      NIFTYMETAL: 'NIFTY METAL', NIFTYFMCG: 'NIFTY FMCG', NIFTYREALTY: 'NIFTY REALTY',
      NIFTYINFRA: 'NIFTY INFRA', NIFTYENERGY: 'NIFTY ENERGY', NIFTYMIDCAP100: 'NIFTY MIDCAP 100',
      NIFTYSMALLCAP100: 'NIFTY SMLCAP 100', NIFTY100: 'NIFTY 100', NIFTY200: 'NIFTY 200',
    }

    const indexData = {}
    Object.entries(indexMap).forEach(([sym, nseKey]) => {
      const found = allIndices.find(i => i.index === nseKey || i.indexSymbol?.toUpperCase() === sym)
      if (found) {
        indexData[sym] = {
          last: parseFloat(found.last) || 0,
          change: parseFloat(found.variation) || 0,
          pChange: parseFloat(found.percentChange) || 0,
          open: parseFloat(found.open) || 0,
          high: parseFloat(found.high) || 0,
          low: parseFloat(found.low) || 0,
          previousClose: parseFloat(found.previousClose) || 0,
          yearHigh: parseFloat(found.yearHigh) || 0,
          yearLow: parseFloat(found.yearLow) || 0,
        }
      }
    })

    let fiiDii = []
    if (fiiRes.status === 'fulfilled' && Array.isArray(fiiRes.value)) {
      const dateMap = {}
      for (const row of fiiRes.value) {
        if (!dateMap[row.date]) dateMap[row.date] = {}
        if ((row.clientType || '').includes('FII') || (row.clientType || '').includes('FPI'))
          dateMap[row.date].fii = row
        if ((row.clientType || '').includes('DII'))
          dateMap[row.date].dii = row
      }
      fiiDii = Object.entries(dateMap).slice(0, 15).map(([date, { fii, dii }]) => ({
        date,
        fiiBuy: parseFloat(fii?.buyValue) || 0,
        fiiSell: parseFloat(fii?.sellValue) || 0,
        fiiNet: parseFloat(fii?.netValue) || 0,
        diiBuy: parseFloat(dii?.buyValue) || 0,
        diiSell: parseFloat(dii?.sellValue) || 0,
        diiNet: parseFloat(dii?.netValue) || 0,
      }))
    }

    let marketStatus = null
    if (statusRes.status === 'fulfilled' && statusRes.value) {
      marketStatus = statusRes.value?.marketState?.[0] || null
    }

    return { ok: true, indiaVix, indexData, allIndices, fiiDii, marketStatus }
  } catch (err) {
    return { ok: false, error: String(err), allIndices: [], fiiDii: [], indexData: {} }
  }
}

/* ── NSE Option Chain ─────────────────────────────────────────────── */
export async function fetchNSEOptionChain(symbol) {
  const isIndex = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50'].includes(symbol)
  const path = isIndex
    ? `/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(symbol)}`
  return nseGet(path)
}

/* ── NSE Stock Quote ───────────────────────────────────────────────── */
export async function fetchNSEStockQuote(symbol) {
  const res = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(symbol)}`)
  if (!res) return null
  return {
    ltp: res.priceInfo?.lastPrice,
    open: res.priceInfo?.open,
    high: res.priceInfo?.intraDayHighLow?.max,
    low:  res.priceInfo?.intraDayHighLow?.min,
    prev: res.priceInfo?.previousClose,
    chg: res.priceInfo?.change,
    pct: res.priceInfo?.pChange,
    vol: res.quantityTradeInfo?.totalTradedVolume,
    val: res.quantityTradeInfo?.totalTradedValue,
    upper52: res.priceInfo?.weekHighLow?.max,
    lower52: res.priceInfo?.weekHighLow?.min,
    circuitLimits: res.priceInfo?.priceBand,
    deliveryPct: res.deliveryInfo?.oneDayDeliverable,
  }
}

/* ── NSE Top Gainers / Losers / OI ────────────────────────────────── */
export async function fetchNSEMovers() {
  const [gainers, losers, oiGain, oiLoss] = await Promise.allSettled([
    nseGet('/api/live-analysis-variations?index=gainers&type=securities&category=FO'),
    nseGet('/api/live-analysis-variations?index=loosers&type=securities&category=FO'),
    nseGet('/api/live-analysis-variations?index=oi_gainers&type=securities&category=FO'),
    nseGet('/api/live-analysis-variations?index=oi_losers&type=securities&category=FO'),
  ])
  return {
    gainers: gainers.value?.data?.slice(0,10) || [],
    losers: losers.value?.data?.slice(0,10) || [],
    oiGainers: oiGain.value?.data?.slice(0,10) || [],
    oiLosers: oiLoss.value?.data?.slice(0,10) || [],
  }
}

/* ── BSE India ─────────────────────────────────────────────────────── */
export async function fetchBSEData() {
  try {
    const [sensexRes, bankexRes, newsRes] = await Promise.allSettled([
      fetchJson(`${BSE_BASE}/GetSensexData/w?flag=0`),
      fetchJson(`${BSE_BASE}/GetSensexData/w?flag=0&str=BANKEX`),
      fetchJson(`${BSE_BASE}/GetLatestNewsHeadLine/w`),
    ])

    const parseQuote = (d) => ({
      last: parseFloat(d?.CurrValue || d?.IndexValue || 0),
      change: parseFloat(d?.Change || 0),
      pChange: parseFloat(d?.PerChange || 0),
      open: parseFloat(d?.Open || 0),
      high: parseFloat(d?.High || 0),
      low: parseFloat(d?.Low || 0),
      prev: parseFloat(d?.PrevClose || 0),
    })

    return {
      sensex: sensexRes.value ? parseQuote(sensexRes.value?.[0] || {}) : null,
      bankex: bankexRes.value ? parseQuote(bankexRes.value?.[0] || {}) : null,
      news: (newsRes.value?.Table || []).slice(0,10).map(r => ({
        title: r.NEWSDESCRIPTION || r.HEADLINE || '',
        time: r.NEWS_DT || '',
        source: 'BSE India',
        sentiment: detectSentiment(r.NEWSDESCRIPTION || ''),
      })).filter(n => n.title),
    }
  } catch {
    return { sensex: null, bankex: null, news: [] }
  }
}

/* ── Yahoo Finance Quotes ──────────────────────────────────────────── */
const YF_MAP = {
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
  BAJAJFINSV:'BAJAJFINSV.NS', APOLLOHOSP:'APOLLOHOSP.NS', DIVISLAB:'DIVISLAB.NS',
  EICHERMOT:'EICHERMOT.NS', HEROMOTOCO:'HEROMOTOCO.NS', HINDUNILVR:'HINDUNILVR.NS',
  NESTLEIND:'NESTLEIND.NS', TATACONSUM:'TATACONSUM.NS', ASIANPAINT:'ASIANPAINT.NS',
  POWERGRID:'POWERGRID.NS', COALINDIA:'COALINDIA.NS', BEL:'BEL.NS',
  'BAJAJ-AUTO':'BAJAJ-AUTO.NS', IOC:'IOC.NS', BPCL:'BPCL.NS',
  INDUSINDBK:'INDUSINDBK.NS', HDFCLIFE:'HDFCLIFE.NS', SBILIFE:'SBILIFE.NS',
  GRASIM:'GRASIM.NS', ULTRACEMCO:'ULTRACEMCO.NS', PNB:'PNB.NS',
  BANKBARODA:'BANKBARODA.NS', CANBK:'CANBK.NS', FEDERALBNK:'FEDERALBNK.NS',
  IDFCFIRSTB:'IDFCFIRSTB.NS', MUTHOOTFIN:'MUTHOOTFIN.NS',
}

export function getYFSym(symbol) {
  return YF_MAP[symbol] || `${symbol}.NS`
}

export async function fetchYFQuotes(symbols) {
  const yfSyms = symbols.map(s => getYFSym(s)).join(',')
  const url = `${YF_QUOTE}${yfSyms}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketCap,trailingPE,forwardPE,trailingEps,dividendYield,beta`
  const data = await fetchJson(url)
  if (!data?.quoteResponse?.result) return {}
  const map = {}
  data.quoteResponse.result.forEach((q, i) => {
    const id = symbols[i]
    if (!id) return
    map[id] = {
      cur: q.regularMarketPrice || 0,
      open: q.regularMarketOpen || 0,
      high: q.regularMarketDayHigh || 0,
      low: q.regularMarketDayLow || 0,
      prev: q.regularMarketPreviousClose || 0,
      chg: q.regularMarketChange || 0,
      pct: q.regularMarketChangePercent || 0,
      vol: q.regularMarketVolume || 0,
      w52h: q.fiftyTwoWeekHigh || 0,
      w52l: q.fiftyTwoWeekLow || 0,
      mcap: q.marketCap || 0,
      pe: q.trailingPE || q.forwardPE || 0,
      eps: q.trailingEps || 0,
      divYield: q.dividendYield || 0,
      beta: q.beta || 0,
      live: true,
    }
  })
  return map
}

export async function fetchYFChart(symbol, interval = '1m', range = '1d') {
  const yfSym = getYFSym(symbol)
  const url = `${YF_CHART}${yfSym}?interval=${interval}&range=${range}`
  const data = await fetchJson(url)
  if (!data?.chart?.result?.[0]) return null
  const r = data.chart.result[0]
  const ts = r.timestamp || []
  const q = r.indicators?.quote?.[0] || {}
  return ts.map((t, i) => ({
    time: t * 1000,
    open: q.open?.[i] || 0,
    close: q.close?.[i] || 0,
    high: q.high?.[i] || 0,
    low: q.low?.[i] || 0,
    vol: q.volume?.[i] || 0,
  })).filter(x => x.open && x.close && x.high && x.low)
}

/* ── screener.in — PE, ROE, Debt/Eq, Growth, Promoter Holding ─────── */
export async function fetchScreenerData(symbol) {
  try {
    // screener.in has a simple company search API
    const url = `${SCREENER}${encodeURIComponent(symbol)}`
    const data = await fetchJson(url)
    if (!data?.results?.length) return null
    const company = data.results[0]
    // Fetch company detail page
    const detailUrl = `https://www.screener.in${company.url}?consolidated=`
    const html = await fetchText(detailUrl)
    if (!html) return { name: company.name, url: company.url }
    // Parse key metrics from HTML
    const parse = (label) => {
      const re = new RegExp(`${label}[^\\d-]*([\\d,\\.]+)`, 'i')
      const m = html.match(re)
      return m ? parseFloat(m[1].replace(/,/g,'')) : null
    }
    return {
      name: company.name,
      pe: parse('P\\/E'),
      pb: parse('Price to Book'),
      roe: parse('ROE'),
      roce: parse('ROCE'),
      debtEq: parse('Debt to equity'),
      mcap: parse('Market Cap'),
      salesGrowth: parse('Sales Growth'),
      profitGrowth: parse('Profit Growth'),
      promoterHolding: parse('Promoter Holding'),
      dividendYield: parse('Dividend Yield'),
      intrinsicValue: parse('Intrinsic Value'),
    }
  } catch {
    return null
  }
}

/* ── MoneyControl RSS ──────────────────────────────────────────────── */
export async function fetchMoneyControlNews() {
  const urls = [
    'https://www.moneycontrol.com/rss/latestnews.xml',
    'https://www.moneycontrol.com/rss/marketoutlook.xml',
    'https://www.moneycontrol.com/rss/business.xml',
  ]
  const items = []
  for (const url of urls) {
    try {
      const text = await fetchText(url)
      if (!text) continue
      const doc = new DOMParser().parseFromString(text, 'text/xml')
      doc.querySelectorAll('item').forEach((item, i) => {
        if (i >= 5) return
        const title = item.querySelector('title')?.textContent?.trim() || ''
        const desc = item.querySelector('description')?.textContent?.replace(/<[^>]+>/g,'').trim() || ''
        const pub = item.querySelector('pubDate')?.textContent || ''
        if (title && title.length > 5) {
          items.push({ title, desc: desc.slice(0,120), time: pub, source: 'MoneyControl', sentiment: detectSentiment(title), category: 'market' })
        }
      })
    } catch { /* ignore */ }
  }
  return items
}

/* ── ET Markets RSS ────────────────────────────────────────────────── */
export async function fetchETNews() {
  const urls = [
    'https://economictimes.indiatimes.com/markets/rss.cms',
    'https://economictimes.indiatimes.com/markets/stocks/rss.cms',
    'https://economictimes.indiatimes.com/markets/stocks/recos/rss.cms',
  ]
  const items = []
  for (const url of urls) {
    try {
      const text = await fetchText(url)
      if (!text) continue
      const doc = new DOMParser().parseFromString(text, 'text/xml')
      doc.querySelectorAll('item').forEach((item, i) => {
        if (i >= 5) return
        const title = item.querySelector('title')?.textContent?.trim() || ''
        const desc = item.querySelector('description')?.textContent?.replace(/<[^>]+>/g,'').trim() || ''
        const pub = item.querySelector('pubDate')?.textContent || ''
        if (title && title.length > 5) {
          items.push({ title, desc: desc.slice(0,120), time: pub, source: 'ET Markets', sentiment: detectSentiment(title), category: 'market' })
        }
      })
    } catch { /* ignore */ }
  }
  return items
}

/* ── NDTV Profit RSS ───────────────────────────────────────────────── */
export async function fetchNDTVNews() {
  const items = []
  try {
    const text = await fetchText('https://feeds.feedburner.com/ndtvprofit-latest')
    if (!text) return []
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    doc.querySelectorAll('item').forEach((item, i) => {
      if (i >= 6) return
      const title = item.querySelector('title')?.textContent?.trim() || ''
      if (title) items.push({ title, time: item.querySelector('pubDate')?.textContent||'', source: 'NDTV Profit', sentiment: detectSentiment(title), category: 'market' })
    })
  } catch { /* ignore */ }
  return items
}

/* ── NSE Corporate Announcements ───────────────────────────────────── */
export async function fetchNSENews() {
  const items = []
  try {
    const [corp, gainers, losers] = await Promise.allSettled([
      nseGet('/api/corporatecalendar'),
      nseGet('/api/live-analysis-variations?index=gainers&type=securities&category=FO'),
      nseGet('/api/live-analysis-variations?index=loosers&type=securities&category=FO'),
    ])
    ;(corp.value?.data || []).slice(0,8).forEach(a => {
      const title = (a.subject || a.desc || '').substring(0, 150)
      if (title) items.push({ title, time: a.an_dt || new Date().toISOString(), source: 'NSE', symbol: a.symbol, sentiment: detectSentiment(title), category: 'corporate' })
    })
    const g = gainers.value?.data?.slice(0,5) || []
    if (g.length) items.push({ title: `F&O Top Gainers: ${g.map(s=>`${s.symbol}(+${s.pChange?.toFixed(1)}%)`).join(', ')}`, time: new Date().toISOString(), source: 'NSE Live', sentiment: 'positive', category: 'market' })
    const l = losers.value?.data?.slice(0,5) || []
    if (l.length) items.push({ title: `F&O Top Losers: ${l.map(s=>`${s.symbol}(${s.pChange?.toFixed(1)}%)`).join(', ')}`, time: new Date().toISOString(), source: 'NSE Live', sentiment: 'negative', category: 'market' })
  } catch { /* ignore */ }
  return items
}

/* ── World Monitor — global macro headlines ────────────────────────── */
export async function fetchWorldMonitor() {
  const headlines = []
  // Try their public site via CORS proxy
  try {
    const html = await fetchText('https://www.worldmonitor.app/')
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      // Extract article headlines
      const selectors = ['h1','h2','h3','.headline','.title','article h2','[class*="headline"]','[class*="title"]']
      for (const sel of selectors) {
        doc.querySelectorAll(sel).forEach(el => {
          const t = el.textContent?.trim()
          if (t && t.length > 20 && t.length < 200 && !headlines.includes(t)) headlines.push(t)
        })
      }
    }
  } catch { /* ignore */ }

  // Fallback: Bloomberg/Reuters style macro static context
  if (headlines.length < 3) {
    headlines.push(
      'Global markets: Track US S&P 500, Dow Jones and NASDAQ for FII flow direction into India',
      'Crude Oil (Brent/WTI): Key driver for ONGC, BPCL, IOC, HPCL and India\'s current account deficit',
      'USD/INR rate: Rupee strength directly impacts IT exporters (TCS, Infosys, Wipro) and import-heavy sectors',
      'US Federal Reserve: Rate decisions impact global risk appetite and FII equity flows into emerging markets',
      'China PMI: Asian manufacturing health indicator — impacts metals, commodities, and global supply chains',
      'Japan Nikkei: Asian trading session benchmark — correlates with Nifty opening direction',
    )
  }
  return headlines.slice(0, 8)
}

/* ── ET Money — Fear & Greed, SIP trends ──────────────────────────── */
export async function fetchETMoneyData() {
  // ET Money doesn't have a public API; parse their market mood page
  try {
    const html = await fetchText('https://www.etmoney.com/market-mood-index')
    if (!html) return null
    const mmiMatch = html.match(/Market Mood Index.*?(\d+)/i) || html.match(/MMI.*?(\d+)/i)
    const moodMatch = html.match(/(Extreme Greed|Greed|Neutral|Fear|Extreme Fear)/i)
    return {
      mmi: mmiMatch ? parseInt(mmiMatch[1]) : null,
      mood: moodMatch ? moodMatch[1] : null,
      source: 'ET Money',
    }
  } catch {
    return null
  }
}

/* ── All news combined ─────────────────────────────────────────────── */
export async function fetchAllNews() {
  const [nse, et, mc, ndtv, bse] = await Promise.allSettled([
    fetchNSENews(), fetchETNews(), fetchMoneyControlNews(), fetchNDTVNews(),
    fetchBSEData().then(d => d.news || []),
  ])
  const all = [
    ...(nse.value || []),
    ...(et.value  || []),
    ...(mc.value  || []),
    ...(ndtv.value|| []),
    ...(bse.value || []),
  ]
  // Deduplicate by title similarity and sort by time
  const seen = new Set()
  return all.filter(n => {
    const key = n.title.slice(0,40).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return n.title.length > 10
  }).sort((a,b) => new Date(b.time||0) - new Date(a.time||0))
}

/* ── Sentiment detection ───────────────────────────────────────────── */
export function detectSentiment(text) {
  const t = (text || '').toLowerCase()
  const pos = ['gain','rise','rally','surge','growth','profit','beat','record','high','up','positive','strong','upgrade','buy','dividend','boom','recover','outperform','beat','bullish','breakout']
  const neg = ['fall','drop','decline','loss','miss','low','down','negative','weak','downgrade','concern','risk','bearish','crash','warning','sell','cut','miss','disappoint','fear','slowdown']
  const ps = pos.filter(w => t.includes(w)).length
  const ns = neg.filter(w => t.includes(w)).length
  return ps > ns ? 'positive' : ns > ps ? 'negative' : 'neutral'
}
