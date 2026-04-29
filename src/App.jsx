/* ═══════════════════════════════════════════════════════════════════════════
   TradeIQ Pro / Aladdin v5 — FINAL COMPLETE APP
   All requirements from chat history integrated:
   ✅ Live option chain (NSE API + Black-Scholes fallback)
   ✅ Live PCR, Max Pain, Max OI levels
   ✅ Trade signals: Buy/Sell + Strike + SL + Target (weekly & monthly)
   ✅ Institutional data (FII/DII with daily flows)
   ✅ Stocks screener (Yahoo Finance + screener.in)
   ✅ All F&O stocks buy/sell/hold signal cards
   ✅ Working AI chat (Claude API — any question)
   ✅ Trade Mode: 2 dropdowns (options + stocks) for intraday/weekly/monthly
   ✅ All 6 indices with live data
   ✅ World Monitor + ET Markets + MoneyControl + NSE news
   ✅ TradingView charts for all 6 indices
   ✅ Pattern detection from Pine Script (30+ candlestick patterns)
═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ALL_INDICES, FNO_STOCKS, FNO_LOTS, SPOT_REF, CAT_COLORS, getLot, getATM, getStrikeStep } from './utils/marketData.js'
import { fetchMarketData, fetchYFQuotes, fetchYFChart, fetchNSEOptionChain, fetchNSENews, fetchRSSNews } from './utils/api.js'
import { generateSignal, detectAllPatterns, buildOptionChain, calcGreeks, bsApprox, getDaysToExpiry, getExpiryLabel, calcPivots, calcMaxPain } from './utils/indicators.js'
import { sma, ema, rsi, macd, bb } from './utils/indicators.js'

/* ─── Constants ─────────────────────────────────────────────────────────── */
const RF = 0.065
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-sonnet-4-6'

const ALL_SYMBOLS = [
  ...ALL_INDICES.map(i => ({ ...i, symbol: i.symbol, type: 'index' })),
  ...FNO_STOCKS.slice(0, 60).map(s => ({
    symbol: s, name: s, type: 'equity',
    strikeStep: getStrikeStep(s), lot: getLot(s),
    tv: `NSE:${s.replace('&','').replace('-','_')}`,
    color: '#aabbff', exch: 'NSE',
  })),
]

/* ─── Utility functions ──────────────────────────────────────────────────── */
const ts  = () => new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })
const fmt = (n, d=2) => {
  if (n === null || n === undefined || isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e7) return (n < 0 ? '-₹' : '₹') + (a/1e7).toFixed(1) + 'Cr'
  if (a >= 1e5) return (n < 0 ? '-₹' : '₹') + (a/1e5).toFixed(1) + 'L'
  if (a >= 1e3) return (n < 0 ? '-₹' : '₹') + (a/1e3).toFixed(1) + 'K'
  return (n < 0 ? '-₹' : '₹') + a.toFixed(d)
}
const fmtN = (n) => n >= 1e7 ? (n/1e7).toFixed(1)+'Cr' : n >= 1e5 ? (n/1e5).toFixed(1)+'L' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0)
const fmtPct = (n) => n === null || isNaN(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v))
const pick = a => a[Math.floor(Math.random() * a.length)]

function nowIST() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return { h: d.getHours(), m: d.getMinutes(), day: d.getDay() }
}
function marketStatus() {
  const { h, m, day } = nowIST()
  if (day === 0 || day === 6) return 'CLOSED'
  const t = h * 60 + m
  if (t >= 9*60+15 && t <= 15*60+30) return 'OPEN'
  if (t >= 9*60 && t < 9*60+15) return 'PRE'
  return 'CLOSED'
}

/* ─── Toast Component ───────────────────────────────────────────────────── */
function Toasts({ toasts, dismiss }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
          <span style={{ fontSize: 16 }}>{t.icon}</span>
          <div>
            <div style={{ fontWeight: 700 }}>{t.title}</div>
            <div style={{ fontSize: 10, opacity: 0.75 }}>{t.msg}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── TradingView Chart ──────────────────────────────────────────────────── */
function TVChart({ symbol, height = 320 }) {
  const ref = useRef(null)
  const s = ALL_SYMBOLS.find(x => x.symbol === symbol) || ALL_INDICES[0]
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ''
    const id = 'tv_' + symbol + '_' + Date.now()
    const div = document.createElement('div')
    div.id = id; div.style.cssText = `width:100%;height:${height}px`
    ref.current.appendChild(div)
    const make = () => {
      try {
        new window.TradingView.widget({
          container_id: id, autosize: false, width: '100%', height,
          symbol: s.tv || `NSE:${symbol}`, interval: 'D',
          timezone: 'Asia/Kolkata', theme: 'dark', style: '1', locale: 'en',
          toolbar_bg: '#050a12', enable_publishing: false, withdateranges: true,
          hide_side_toolbar: false, allow_symbol_change: true, show_popup_button: false,
          studies: ['RSI@tv-basicstudies','MACD@tv-basicstudies','BB@tv-basicstudies','EMA@tv-basicstudies','Volume@tv-basicstudies'],
          overrides: { 'paneProperties.background': '#050a12', 'scalesProperties.textColor': '#4a6a85' },
          save_image: false,
        })
      } catch { /* ignore */ }
    }
    if (window.TradingView?.widget) make()
    else { const sc = document.createElement('script'); sc.src = 'https://s3.tradingview.com/tv.js'; sc.onload = make; document.head.appendChild(sc) }
  }, [symbol, height])
  return <div ref={ref} />
}

/* ─── Settings Modal ─────────────────────────────────────────────────────── */
function SettingsModal({ cfg, onSave, onClose }) {
  const [v, setV] = useState({ ...cfg })
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <span style={{ fontFamily:'Orbitron,monospace', fontSize:14, fontWeight:700, color:'var(--accent-cyan)', letterSpacing:2 }}>⚙ SETTINGS</span>
          <button onClick={onClose} style={{ color:'var(--text-secondary)', fontSize:20 }}>✕</button>
        </div>
        {[
          { k:'apiKey', l:'ANTHROPIC API KEY', t:'password', ph:'sk-ant-api03-...', hint:'Required for AI chat. Get from console.anthropic.com' },
          { k:'capital', l:'PAPER CAPITAL (₹)', t:'number', ph:'5000000', hint:'Starting capital for paper trading & position sizing' },
          { k:'zerodha', l:'ZERODHA API KEY', t:'text', ph:'Optional — for live order execution', hint:'OPTIONAL: Terminal works fully without this (paper trading)' },
        ].map(f => (
          <div key={f.k} style={{ marginBottom: 14 }}>
            <div style={{ fontSize:9, letterSpacing:1, color:'var(--text-secondary)', marginBottom:4 }}>{f.l}</div>
            <input type={f.t} className="modal-input" placeholder={f.ph} value={v[f.k]||''} onChange={e=>setV(p=>({...p,[f.k]:e.target.value}))}/>
            {f.hint && <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:3 }}>{f.hint}</div>}
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize:9, letterSpacing:1, color:'var(--text-secondary)', marginBottom:4 }}>AI MODEL</div>
          <select className="modal-select" value={v.model||DEFAULT_MODEL} onChange={e=>setV(p=>({...p,model:e.target.value}))}>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 (Recommended — Fast + Smart)</option>
            <option value="claude-opus-4-6">claude-opus-4-6 (Most Powerful)</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (Fastest)</option>
          </select>
        </div>
        <button className="btn-cyber" style={{ width:'100%', padding:11, fontSize:12, marginTop:6 }}
          onClick={() => { onSave(v); onClose() }}>
          💾 SAVE CONFIGURATION
        </button>
      </div>
    </div>
  )
}

/* ─── Option Chain Table ─────────────────────────────────────────────────── */
function OptionChainTable({ chain, spot, showGreeks, onStrikeClick }) {
  if (!chain?.rows?.length) return <div style={{ color:'var(--text-dim)', padding:12, fontSize:11 }}>Loading option chain data...</div>
  const maxCeOI = Math.max(...chain.rows.map(r=>r.ce?.oi||0), 1)
  const maxPeOI = Math.max(...chain.rows.map(r=>r.pe?.oi||0), 1)
  return (
    <div style={{ overflowX:'auto' }}>
      <table className="opt-table">
        <thead>
          <tr>
            <th className="opt-call">OI</th>
            <th className="opt-call">ChgOI</th>
            {showGreeks && <><th className="opt-call">Δ</th><th className="opt-call">Θ</th><th className="opt-call">IV%</th></>}
            <th className="opt-call">Vol</th>
            <th className="opt-call">LTP</th>
            <th className="opt-call">Chg%</th>
            <th className="center" style={{ background:'rgba(0,212,255,.06)', minWidth:90 }}>STRIKE</th>
            <th className="opt-put">Chg%</th>
            <th className="opt-put">LTP</th>
            <th className="opt-put">Vol</th>
            {showGreeks && <><th className="opt-put">IV%</th><th className="opt-put">Θ</th><th className="opt-put">Δ</th></>}
            <th className="opt-put">ChgOI</th>
            <th className="opt-put">OI</th>
          </tr>
        </thead>
        <tbody>
          {chain.rows.map(row => (
            <tr key={row.strike}
              className={`${row.isATM?'atm':''} ${row.isITM_CE?'itm-ce':''} ${row.isITM_PE?'itm-pe':''}`}
              style={{ cursor:'pointer' }} onClick={() => onStrikeClick && onStrikeClick(row)}>
              <td className="opt-call">
                <div>{fmtN(row.ce?.oi)}</div>
                <div className="oi-bar-bg"><div className="oi-bar-fill-ce" style={{ width:`${(row.ce?.oi||0)/maxCeOI*100}%` }}/></div>
              </td>
              <td className="opt-call" style={{ color:(row.ce?.chgOI||0)>=0?'var(--accent-green)':'var(--accent-red)', fontSize:9 }}>
                {(row.ce?.chgOI||0)>=0?'+':''}{fmtN(row.ce?.chgOI||0)}
              </td>
              {showGreeks && <>
                <td className="opt-call">{row.ce?.delta}</td>
                <td className="opt-call">{row.ce?.theta}</td>
                <td className="opt-call">{row.ce?.iv}%</td>
              </>}
              <td className="opt-call" style={{ fontSize:9, color:'var(--text-dim)' }}>{fmtN(row.ce?.vol||0)}</td>
              <td className="opt-call" style={{ fontWeight:row.isATM?800:500, fontSize:12 }}>₹{(row.ce?.px||0).toFixed(2)}</td>
              <td style={{ color:(row.ce?.chgPct||0)>=0?'var(--accent-green)':'var(--accent-red)', fontSize:9 }}>
                {(row.ce?.chgPct||0)>=0?'+':''}{(row.ce?.chgPct||0).toFixed(1)}%
              </td>
              <td className="center strike-col" style={{
                fontFamily:'Orbitron,monospace', fontSize:12, fontWeight:800,
                background:row.isATM?'rgba(0,212,255,.12)':'rgba(5,10,20,.8)', minWidth:90,
              }}>
                {row.strike}
                {row.isATM && <div style={{ fontSize:7, color:'var(--accent-cyan)' }}>◉ ATM</div>}
              </td>
              <td style={{ color:(row.pe?.chgPct||0)>=0?'var(--accent-green)':'var(--accent-red)', fontSize:9 }}>
                {(row.pe?.chgPct||0)>=0?'+':''}{(row.pe?.chgPct||0).toFixed(1)}%
              </td>
              <td className="opt-put" style={{ fontWeight:row.isATM?800:500, fontSize:12 }}>₹{(row.pe?.px||0).toFixed(2)}</td>
              <td className="opt-put" style={{ fontSize:9, color:'var(--text-dim)' }}>{fmtN(row.pe?.vol||0)}</td>
              {showGreeks && <>
                <td className="opt-put">{row.pe?.iv}%</td>
                <td className="opt-put">{row.pe?.theta}</td>
                <td className="opt-put">{row.pe?.delta}</td>
              </>}
              <td className="opt-put" style={{ color:(row.pe?.chgOI||0)>=0?'var(--accent-green)':'var(--accent-red)', fontSize:9 }}>
                {(row.pe?.chgOI||0)>=0?'+':''}{fmtN(row.pe?.chgOI||0)}
              </td>
              <td className="opt-put">
                <div>{fmtN(row.pe?.oi)}</div>
                <div className="oi-bar-bg"><div className="oi-bar-fill-pe" style={{ width:`${(row.pe?.oi||0)/maxPeOI*100}%` }}/></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ─── PCR + MaxPain bar ──────────────────────────────────────────────────── */
function PCRBar({ pcr, maxPain, ceResist, peSupport, atm }) {
  const bias = pcr > 1.3 ? 'BULLISH' : pcr < 0.7 ? 'BEARISH' : pcr > 1.0 ? 'SLIGHTLY BULLISH' : 'SLIGHTLY BEARISH'
  const biasColor = pcr > 1.3 ? 'var(--accent-green)' : pcr < 0.7 ? 'var(--accent-red)' : 'var(--accent-gold)'
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
      {[
        { l:'PCR', v:pcr?.toFixed(2)||'—', c:biasColor, sub:bias },
        { l:'ATM', v:atm||'—', c:'var(--accent-cyan)', sub:'At-the-Money' },
        { l:'Max Pain', v:maxPain||'—', c:'var(--accent-purple)', sub:'Gamma neutral' },
        { l:'CE Resistance', v:ceResist?.strike||'—', c:'var(--accent-red)', sub:`${fmtN(ceResist?.oi||0)} OI` },
        { l:'PE Support', v:peSupport?.strike||'—', c:'var(--accent-green)', sub:`${fmtN(peSupport?.oi||0)} OI` },
      ].map(m => (
        <div key={m.l} style={{ flex:1, minWidth:80, background:'rgba(0,0,0,.5)', border:'1px solid var(--border-cyber)', borderRadius:5, padding:'6px 10px', textAlign:'center' }}>
          <div style={{ fontSize:7, color:'var(--text-secondary)', letterSpacing:1 }}>{m.l}</div>
          <div style={{ fontSize:13, fontWeight:800, color:m.c, fontFamily:'Orbitron,monospace' }}>{m.v}</div>
          <div style={{ fontSize:7, color:'var(--text-dim)' }}>{m.sub}</div>
        </div>
      ))}
    </div>
  )
}

/* ─── Trade Signal Card (option) ─────────────────────────────────────────── */
function OptionSignalCard({ sig, onBuy, onSell, compact }) {
  if (!sig) return null
  const bull = sig.side === 'BUY'
  const rr = ((sig.sellAt - sig.buyAt) / Math.max(sig.buyAt - sig.stoploss, 0.01)).toFixed(1)
  const profitPct = ((sig.sellAt - sig.buyAt) / sig.buyAt * 100).toFixed(1)
  const slPct = ((sig.buyAt - sig.stoploss) / sig.buyAt * 100).toFixed(1)

  if (compact) return (
    <div className={`opt-trade-card ${bull ? 'buy' : 'sell'}`} style={{ padding:'10px 12px', marginBottom:6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
        <span style={{ color:bull?'var(--accent-green)':'var(--accent-red)', fontFamily:'Orbitron,monospace', fontSize:11, fontWeight:800 }}>
          {sig.symbol} {sig.strike} {sig.optType}
        </span>
        <span className={bull ? 'badge-buy badge' : 'badge-sell badge'} style={{ fontSize:8 }}>
          {sig.expType?.toUpperCase()} {bull?'CE':'PE'}
        </span>
      </div>
      <div className="otc-price-row">
        <div className="otc-price-box otc-buy-box">
          <div className="otc-price-lbl" style={{ color:'var(--accent-green)' }}>BUY AT</div>
          <div className="otc-price-val" style={{ color:'var(--accent-green)', fontSize:15 }}>₹{sig.buyAt}</div>
        </div>
        <div className="otc-price-box otc-sl-box">
          <div className="otc-price-lbl" style={{ color:'var(--accent-red)' }}>STOP LOSS</div>
          <div className="otc-price-val" style={{ color:'var(--accent-red)', fontSize:15 }}>₹{sig.stoploss}</div>
        </div>
        <div className="otc-price-box otc-tgt-box">
          <div className="otc-price-lbl" style={{ color:'gold' }}>TARGET</div>
          <div className="otc-price-val" style={{ color:'gold', fontSize:15 }}>₹{sig.sellAt}</div>
        </div>
      </div>
      <div className="otc-chips">
        <span className="otc-chip info">Δ {sig.delta}</span>
        <span className="otc-chip neg">Θ -₹{Math.abs(sig.theta||0)}/d</span>
        <span className="otc-chip">IV {sig.iv}%</span>
        <span className={`otc-chip ${parseFloat(rr)>=1.5?'pos':'warn'}`}>RR 1:{rr}</span>
        <span className="otc-chip">PCR {sig.pcr}</span>
        <span className="otc-chip warn">MaxPain {sig.maxPain}</span>
        <span className="otc-chip">Lot {sig.lot}</span>
      </div>
      <div className="otc-actions" style={{ marginTop:8 }}>
        <button className="btn-buy" style={{ fontSize:10 }} onClick={() => onBuy?.(sig)}>▲ BUY ₹{sig.buyAt}</button>
        <button className="btn-sell" style={{ fontSize:10 }} onClick={() => onSell?.(sig)}>SL ₹{sig.stoploss} / TGT ₹{sig.sellAt}</button>
      </div>
    </div>
  )

  return (
    <div className={`opt-trade-card ${bull ? 'buy' : 'sell'}`}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <div>
          <div style={{ fontSize:9, letterSpacing:2, color:bull?'var(--accent-green)':'var(--accent-red)', fontWeight:800 }}>
            {bull?'▲ CALL OPTION — BUY CE':'▼ PUT OPTION — BUY PE'} · {sig.expType?.toUpperCase()}
          </div>
          <div className="otc-sym" style={{ color:bull?'var(--accent-green)':'var(--accent-red)' }}>{sig.symbol}</div>
          <div className="otc-strike">{sig.strike} {sig.optType}</div>
          <div style={{ fontSize:9, color:'var(--text-secondary)' }}>{sig.expType} Expiry · {sig.daysToExp}D · Lot:{sig.lot}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <span className={bull?'badge-buy badge':'badge-sell badge'}>{bull?'CE BUY':'PE BUY'}</span>
          <div style={{ fontSize:9, color:'var(--text-secondary)', marginTop:4 }}>Score: {sig.score}%</div>
          <div className="conf-bar" style={{ width:80, marginTop:3 }}>
            <div className={`conf-fill ${bull?'buy':'sell'}`} style={{ width:`${sig.score}%` }}/>
          </div>
        </div>
      </div>

      <div className="otc-price-row">
        <div className="otc-price-box otc-buy-box">
          <div className="otc-price-lbl" style={{ color:'var(--accent-green)' }}>BUY AT</div>
          <div className="otc-price-val" style={{ color:'var(--accent-green)' }}>₹{sig.buyAt}</div>
          <div className="otc-price-sub">Entry premium</div>
        </div>
        <div className="otc-price-box otc-sl-box">
          <div className="otc-price-lbl" style={{ color:'var(--accent-red)' }}>STOP LOSS</div>
          <div className="otc-price-val" style={{ color:'var(--accent-red)' }}>₹{sig.stoploss}</div>
          <div className="otc-price-sub">Risk: {slPct}%</div>
        </div>
        <div className="otc-price-box otc-tgt-box">
          <div className="otc-price-lbl" style={{ color:'gold' }}>TARGET</div>
          <div className="otc-price-val" style={{ color:'gold' }}>₹{sig.sellAt}</div>
          <div className="otc-price-sub">+{profitPct}%</div>
        </div>
      </div>

      <div className="otc-chips">
        <span className={`otc-chip ${bull?'pos':'neg'}`}>Δ Delta: {sig.delta}</span>
        <span className="otc-chip neg">Θ Theta: -₹{Math.abs(sig.theta||0)}/day</span>
        <span className="otc-chip">IV: {sig.iv}%</span>
        <span className={`otc-chip ${parseFloat(rr)>=1.5?'pos':'warn'}`}>R:R = 1:{rr}</span>
        <span className="otc-chip">CE Resist: {sig.ceResist}</span>
        <span className="otc-chip">PE Support: {sig.peSupport}</span>
        <span className={`otc-chip ${sig.pcr>1.1?'pos':sig.pcr<0.9?'neg':'warn'}`}>PCR: {sig.pcr}</span>
        <span className="otc-chip warn">Max Pain: {sig.maxPain}</span>
        <span className="otc-chip">Lot Val: {fmt((sig.buyAt||0)*(sig.lot||75),0)}</span>
        <span className="otc-chip neg">Max Risk: {fmt(((sig.buyAt||0)-(sig.stoploss||0))*(sig.lot||75),0)}</span>
      </div>

      <div className="otc-analysis">
        {bull
          ? `BUY ${sig.symbol} ${sig.strike}CE @ ₹${sig.buyAt}. Delta ${sig.delta}: option gains ₹${sig.delta} per 1pt index move. CE wall at ${sig.ceResist}, PE support at ${sig.peSupport}. PCR ${sig.pcr} — ${sig.pcr>1.2?'Bullish bias':'Neutral'}. Time decay -₹${Math.abs(sig.theta||0)}/day. Max Pain ${sig.maxPain}.`
          : `BUY ${sig.symbol} ${sig.strike}PE @ ₹${sig.buyAt}. Bearish setup. Delta ${sig.delta} (abs). CE resistance at ${sig.ceResist}. PCR ${sig.pcr} — ${sig.pcr<0.8?'Bearish bias':'Neutral'}. Stop at ₹${sig.stoploss}, target ₹${sig.sellAt}.`
        }
      </div>

      <div className="otc-actions">
        <button className="btn-buy" style={{ flex:1 }} onClick={() => onBuy?.(sig)}>▲ EXECUTE BUY @ ₹{sig.buyAt}</button>
        <button className="btn-sell" style={{ flex:1 }} onClick={() => onSell?.(sig)}>SET SL ₹{sig.stoploss}</button>
      </div>
    </div>
  )
}

/* ─── Stock Signal Card ──────────────────────────────────────────────────── */
function StockSignalCard({ sym, signal, price, onBuy, onSell }) {
  if (!signal || !price) return null
  const bull = signal.action === 'BUY'
  const bear = signal.action === 'SELL'
  const cls = bull ? 'buy' : bear ? 'sell' : 'hold'
  return (
    <div className={`signal-card ${cls}`} style={{ cursor:'pointer' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <div>
          <div style={{ fontSize:9, color:'var(--text-dim)', letterSpacing:1 }}>{sym}</div>
          <div style={{ fontSize:14, fontWeight:800, color:'var(--text-primary)' }}>{sym}</div>
          <div style={{ fontFamily:'Share Tech Mono,monospace', fontSize:16, fontWeight:700, color:bull?'var(--accent-green)':bear?'var(--accent-red)':'var(--text-primary)' }}>
            ₹{price.toFixed(2)}
          </div>
        </div>
        <span className={bull?'badge-buy badge':bear?'badge-sell badge':'badge-hold badge'}>
          {signal.strength} {signal.action}
        </span>
      </div>

      <div style={{ marginBottom:6 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ fontSize:9, color:'var(--text-secondary)' }}>Confidence</span>
          <span style={{ fontSize:9, fontWeight:700, color:bull?'var(--accent-green)':bear?'var(--accent-red)':'var(--accent-gold)' }}>{signal.confidence}%</span>
        </div>
        <div className="conf-bar">
          <div className={`conf-fill ${cls}`} style={{ width:`${signal.confidence}%` }}/>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, fontSize:9, marginBottom:6 }}>
        <div><span style={{ color:'var(--text-dim)' }}>Entry </span><span style={{ color:'var(--text-primary)', fontFamily:'mono' }}>₹{signal.entry?.toFixed(1)}</span></div>
        <div><span style={{ color:'var(--text-dim)' }}>SL </span><span style={{ color:'var(--accent-red)' }}>₹{signal.stopLoss?.toFixed(1)}</span></div>
        <div><span style={{ color:'var(--text-dim)' }}>T1 </span><span style={{ color:'var(--accent-green)' }}>₹{signal.target1?.toFixed(1)}</span></div>
        <div><span style={{ color:'var(--text-dim)' }}>T2 </span><span style={{ color:'var(--accent-green)' }}>₹{signal.target2?.toFixed(1)}</span></div>
        <div><span style={{ color:'var(--text-dim)' }}>T3 </span><span style={{ color:'var(--accent-green)' }}>₹{signal.target3?.toFixed(1)}</span></div>
        <div><span style={{ color:'var(--text-dim)' }}>ATR </span><span>₹{signal.atr?.toFixed(1)}</span></div>
      </div>

      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
        {signal.indicators?.slice(0,4).map((ind, i) => (
          <span key={i} style={{ fontSize:8, padding:'1px 6px', background:'rgba(0,212,255,.08)', border:'1px solid rgba(0,212,255,.2)', borderRadius:2 }}>{ind}</span>
        ))}
      </div>

      {signal.optionRecommendation && (
        <div style={{ background:bull?'rgba(0,255,136,.05)':'rgba(255,68,102,.05)', border:`1px solid ${bull?'#00ff8833':'#ff446633'}`, borderRadius:4, padding:'7px 9px', fontSize:9, marginBottom:8 }}>
          <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:3 }}>
            📍 {signal.optionRecommendation.strike}{signal.optionRecommendation.type} · {signal.optionRecommendation.expiry}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <span>Buy: <strong style={{ color:'var(--accent-cyan)' }}>₹{signal.optionRecommendation.buyPrice}</strong></span>
            <span>Target: <strong style={{ color:'var(--accent-green)' }}>₹{signal.optionRecommendation.sellPrice}</strong></span>
            <span>Hold↑: <strong style={{ color:'gold' }}>₹{signal.optionRecommendation.holdPrice}</strong></span>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:5 }}>
        <button className="btn-buy" style={{ flex:1, padding:'5px 0', fontSize:10 }} onClick={() => onBuy?.({ sym, signal, price })}>▲ BUY</button>
        <button className="btn-sell" style={{ flex:1, padding:'5px 0', fontSize:10 }} onClick={() => onSell?.({ sym, signal, price })}>▼ SELL</button>
      </div>
    </div>
  )
}

/* ─── AI Chat Component ──────────────────────────────────────────────────── */
function AIChat({ apiKey, model, context, onAddToast }) {
  const [msgs, setMsgs] = useState([{
    role: 'assistant',
    content: `**Aladdin AI Brain** — I am your institutional F&O trading analyst for Indian markets (NSE/BSE).

I can help you with:
• **Live option signals**: "What is the best NIFTY strike to buy this week?"
• **Entry/SL/Target**: "Give me exact buy price, stop loss and target for BANKNIFTY CE"
• **Option chain analysis**: "Explain PCR of 1.3 for NIFTY"
• **Stock analysis**: "Should I buy RELIANCE today? What is the target?"
• **Greeks**: "What does Delta 0.45 mean for my NIFTY option?"
• **Strategy**: "Best strategy for monthly expiry with ₹2L capital"
• **Market context**: "How will RBI rate decision affect Bank Nifty?"

Ask me anything about Indian F&O markets!`,
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const QUICK = [
    'Best NIFTY strike to buy this week',
    'Bank Nifty monthly option buy/sell signal with entry & SL',
    'Explain PCR ratio and how to use it for trading',
    'Top 3 F&O stocks to buy today with targets',
    'How to read option chain OI buildup',
    'Best strategy for monthly expiry with ₹2 lakh capital',
  ]

  const send = useCallback(async (q) => {
    const text = (q || input).trim()
    if (!text) return
    setInput('')
    setMsgs(p => [...p, { role:'user', content:text }])
    setLoading(true)

    if (!apiKey) {
      setMsgs(p => [...p, { role:'assistant', content:`⚠️ **API Key Required**\n\nPlease add your Anthropic API key in Settings (⚙) to enable AI analysis.\n\nGet your key at: https://console.anthropic.com\n\nFallback analysis:\n${generateFallback(text, context)}` }])
      setLoading(false)
      return
    }

    const systemPrompt = `You are Aladdin — an expert institutional Indian F&O (Futures & Options) analyst and trader. You have real-time knowledge of NSE/BSE markets.

CURRENT MARKET CONTEXT:
${JSON.stringify(context || {}, null, 1)}

You specialize in:
- NSE/BSE option trading: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX
- F&O stocks across all sectors
- Black-Scholes pricing, Greeks (Delta, Gamma, Theta, Vega)
- Option chain PCR, Max Pain, OI analysis
- Technical indicators: RSI, MACD, EMA, SMA, Bollinger Bands, VWAP, Stochastic
- All 30+ candlestick patterns from Pine Script
- Monthly and weekly expiry strategies
- FII/DII institutional flow analysis
- Aladdin risk rules: max 1.5% capital per trade, SMA50 trend filter, 5% kill switch

When giving trade recommendations, ALWAYS specify:
1. Exact instrument: e.g., "NIFTY 23500 CE" or "BANKNIFTY 56000 PE"
2. BUY AT: exact premium price (₹)
3. STOP LOSS: exact premium level (₹)
4. TARGET: exact premium level (₹)
5. Risk:Reward ratio
6. Why this strike (Delta logic)
7. PCR and OI context

Use ₹ for prices. Format clearly with bold headers. Be specific and actionable.`

    try {
      const allMsgs = [...msgs.filter(m=>m.role!=='assistant'||!m.content.includes('Aladdin AI Brain')), { role:'user', content:text }]
      const res = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          max_tokens: 1500,
          system: systemPrompt,
          messages: allMsgs.slice(-8).map(m => ({ role:m.role, content:m.content })),
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message||`HTTP ${res.status}`) }
      const data = await res.json()
      setMsgs(p => [...p, { role:'assistant', content:data.content?.[0]?.text||'No response' }])
    } catch (err) {
      setMsgs(p => [...p, { role:'assistant', content:`❌ AI Error: ${err.message}\n\nFallback:\n${generateFallback(text, context)}` }])
      onAddToast?.('error', '⚠️', 'AI Error', err.message.slice(0,60))
    }
    setLoading(false)
  }, [apiKey, model, input, msgs, context, onAddToast])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Quick chips */}
      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border-cyber)', flexShrink:0 }}>
        <div style={{ fontSize:8, color:'var(--text-dim)', marginBottom:5, letterSpacing:1 }}>QUICK QUERIES</div>
        <div style={{ display:'flex', flexWrap:'wrap' }}>
          {QUICK.map((q,i) => <span key={i} className="ai-chip" onClick={()=>send(q)}>{q}</span>)}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:'auto', padding:'10px 12px' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            marginBottom:10,
            display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start',
          }}>
            <div style={{
              maxWidth:'88%', padding:'8px 12px', borderRadius:6,
              background:m.role==='user'?'rgba(0,212,255,.12)':'rgba(0,0,0,.5)',
              border:`1px solid ${m.role==='user'?'rgba(0,212,255,.3)':'var(--border-cyber)'}`,
              fontSize:11.5, lineHeight:1.7, color:'var(--text-primary)',
              whiteSpace:'pre-wrap', wordBreak:'break-word',
            }}>
              {m.role==='assistant' && <div style={{ fontSize:8, color:'var(--accent-cyan)', marginBottom:5, letterSpacing:1 }}>🧠 ALADDIN AI</div>}
              {formatAIResponse(m.content)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--accent-cyan)', fontSize:11, padding:'5px 0' }}>
            <span className="loader"/> Analyzing Indian market data with {model?.includes('opus')?'claude-opus':'claude-sonnet'}...
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ padding:'10px 12px', borderTop:'1px solid var(--border-cyber)', flexShrink:0, display:'flex', gap:8 }}>
        <textarea className="ai-input" rows={2} value={input} onChange={e=>setInput(e.target.value)}
          placeholder="Ask anything: 'Best NIFTY strike this week with entry, SL & target?' 'Which F&O stocks to buy today?' 'Explain PCR 1.3 for Bank Nifty'..."
          onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }}
          style={{ flex:1, fontSize:11 }}/>
        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
          <button className="btn-cyber" style={{ padding:'6px 12px', whiteSpace:'nowrap' }}
            onClick={()=>send()} disabled={loading || !input.trim()}>
            {loading ? '...' : 'ASK ↵'}
          </button>
          <button className="btn-cyber" style={{ padding:'4px 8px', fontSize:9 }}
            onClick={()=>setMsgs([msgs[0]])}>CLEAR</button>
        </div>
      </div>
    </div>
  )
}

function formatAIResponse(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) return <div key={i} style={{ fontWeight:800, color:'var(--accent-cyan)', marginTop:6, marginBottom:2, fontSize:12 }}>{line.replace(/\*\*/g,'')}</div>
    if (line.match(/^BUY AT:|^ENTRY:|^Entry:/i)) return <div key={i} style={{ color:'var(--accent-green)', fontWeight:700 }}>{'▲ ' + line}</div>
    if (line.match(/^STOP LOSS:|^SL:|^Stop Loss:/i)) return <div key={i} style={{ color:'var(--accent-red)', fontWeight:700 }}>{'🛑 ' + line}</div>
    if (line.match(/^TARGET:|^T1:|^T2:|^T3:/i)) return <div key={i} style={{ color:'gold', fontWeight:700 }}>{'🎯 ' + line}</div>
    if (line.match(/^TRADE:|^Option:|^INSTRUMENT:/i)) return <div key={i} style={{ color:'var(--accent-purple)', fontWeight:800, fontSize:12 }}>{'📍 ' + line}</div>
    if (line.match(/^R:R|^Risk:Reward/i)) return <div key={i} style={{ color:'var(--accent-cyan)' }}>{'⚖ ' + line}</div>
    if (line.startsWith('•') || line.startsWith('-')) return <div key={i} style={{ paddingLeft:8, color:'var(--text-primary)' }}>{line}</div>
    if (line.includes('**')) return <div key={i} style={{ fontWeight:600 }}>{line.replace(/\*\*/g,'')}</div>
    if (line === '') return <div key={i} style={{ height:4 }}/>
    return <div key={i}>{line}</div>
  })
}

function generateFallback(q, ctx) {
  const sym = (ctx?.activeSymbol || 'NIFTY')
  const spot = ctx?.spot || 23897
  const atm = Math.round(spot/50)*50
  return `Based on available data for ${sym} (Spot: ₹${spot.toFixed(0)}):\n\n**TRADE: ${sym} ${atm} CE (Weekly)**\nBUY AT: ₹${(spot*0.003).toFixed(0)}\nSTOP LOSS: ₹${(spot*0.0025).toFixed(0)}\nTARGET: ₹${(spot*0.006).toFixed(0)}\nR:R: 1:2.0\n\nAdd API key in Settings for live AI analysis.`
}

/* ─── Institutional Data Panel ──────────────────────────────────────────── */
function InstitutionalPanel({ fiiDii, vix }) {
  return (
    <div>
      {vix !== null && (
        <div style={{ background:vix>20?'rgba(255,68,102,.08)':vix>15?'rgba(255,187,0,.08)':'rgba(0,255,136,.08)', border:`1px solid ${vix>20?'#ff446644':vix>15?'#ffd70044':'#00ff8844'}`, borderRadius:5, padding:'8px 12px', marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:9, color:'var(--text-secondary)', letterSpacing:1 }}>INDIA VIX</div>
              <div style={{ fontSize:24, fontWeight:900, fontFamily:'Orbitron,monospace', color:vix>20?'var(--accent-red)':vix>15?'var(--accent-gold)':'var(--accent-green)' }}>{vix?.toFixed(2)}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:vix>20?'var(--accent-red)':vix>15?'var(--accent-gold)':'var(--accent-green)', fontWeight:700 }}>
                {vix>20?'HIGH — Options expensive, sell premium':''+vix>15?'ELEVATED — Trade with caution':'LOW — Cheap options, buy premium'}
              </div>
              <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:2 }}>Fear Gauge · Option premium driver</div>
            </div>
          </div>
          <div style={{ marginTop:6, fontSize:9, color:'var(--text-secondary)', lineHeight:1.5 }}>
            VIX {vix?.toFixed(2)} → IV ≈ {vix?.toFixed(1)}% · {vix>20?'Market fearful — hedge positions':'Market calm — directional trades favored'}
          </div>
        </div>
      )}

      {fiiDii?.length > 0 ? (
        <>
          <div style={{ fontSize:9, letterSpacing:1.5, color:'var(--accent-cyan)', marginBottom:8, fontWeight:800 }}>FII / DII INSTITUTIONAL FLOWS (₹ CRORE)</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:10 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--border-cyber)' }}>
                {['DATE','FII BUY','FII SELL','FII NET','DII BUY','DII SELL','DII NET'].map(h=>(
                  <th key={h} style={{ padding:'4px 6px', textAlign:'right', fontSize:8, letterSpacing:1, color:'var(--text-secondary)', background:'#0003' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fiiDii.slice(0,8).map((row, i) => (
                <tr key={i} style={{ borderBottom:'1px solid #00d4ff0a' }}>
                  <td style={{ padding:'4px 6px', fontSize:8, color:'var(--text-dim)' }}>{row.date}</td>
                  <td style={{ padding:'4px 6px', textAlign:'right', color:'var(--accent-green)' }}>₹{(row.fiiBuy/100).toFixed(0)}Cr</td>
                  <td style={{ padding:'4px 6px', textAlign:'right', color:'var(--accent-red)' }}>₹{(row.fiiSell/100).toFixed(0)}Cr</td>
                  <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:700, color:row.fiiNet>=0?'var(--accent-green)':'var(--accent-red)' }}>
                    {row.fiiNet>=0?'+':''}{fmt(row.fiiNet/100,0)}Cr
                  </td>
                  <td style={{ padding:'4px 6px', textAlign:'right', color:'var(--accent-green)' }}>₹{(row.diiBuy/100).toFixed(0)}Cr</td>
                  <td style={{ padding:'4px 6px', textAlign:'right', color:'var(--accent-red)' }}>₹{(row.diiSell/100).toFixed(0)}Cr</td>
                  <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:700, color:row.diiNet>=0?'var(--accent-green)':'var(--accent-red)' }}>
                    {row.diiNet>=0?'+':''}{fmt(row.diiNet/100,0)}Cr
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop:8, padding:8, background:'rgba(0,0,0,.3)', border:'1px solid var(--border-cyber)', borderRadius:4, fontSize:9, color:'var(--text-secondary)', lineHeight:1.6 }}>
            <span style={{ color:'var(--accent-cyan)', fontWeight:700 }}>📊 Reading FII/DII Flows: </span>
            FII net positive = foreign buying, bullish for markets. FII net negative + DII net positive = domestic institutions absorbing FII sales. Combined net positive = broad market support.
          </div>
        </>
      ) : (
        <div style={{ color:'var(--text-dim)', fontSize:10, display:'flex', alignItems:'center', gap:8, padding:10 }}>
          <span className="loader"/> Loading institutional data from NSE...
        </div>
      )}
    </div>
  )
}

/* ─── MAIN APP ───────────────────────────────────────────────────────────── */
export default function App() {
  /* ── Config ── */
  const [cfg, setCfg] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aladdin_v5_cfg') || '{}') }
    catch { return {} }
  })
  const [showSettings, setShowSettings] = useState(false)

  /* ── Navigation ── */
  const [page, setPage] = useState('dashboard')

  /* ── Symbol + prices ── */
  const [activeSymbol, setActiveSymbol] = useState('NIFTY')
  const [prices, setPrices] = useState(() => {
    const p = {}
    Object.entries(SPOT_REF).forEach(([k,v]) => { p[k] = { cur:v, open:v, high:v*1.005, low:v*0.995, prev:v, chg:0, pct:0, vol:0, live:false } })
    ALL_INDICES.forEach(i => { if(!p[i.symbol]) p[i.symbol]={cur:i.strikeStep*100,open:i.strikeStep*100,chg:0,pct:0,vol:0} })
    return p
  })
  const [flashMap, setFlashMap] = useState({})

  /* ── Market data ── */
  const [vix, setVix] = useState(null)
  const [fiiDii, setFiiDii] = useState([])
  const [mktStatus, setMktStatus] = useState(marketStatus())
  const [allNseIndices, setAllNseIndices] = useState([])

  /* ── Option chains ── */
  const [chains, setChains] = useState({}) // { symbol: { weekly: chain, monthly: chain } }
  const [showGreeks, setShowGreeks] = useState(false)
  const [chainExpType, setChainExpType] = useState('weekly')

  /* ── Signals ── */
  const [optionSignals, setOptionSignals] = useState({}) // { symbol: { weekly: sig, monthly: sig } }
  const [stockSignals, setStockSignals] = useState({})
  const priceHistRef = useRef({})

  /* ── Trade Mode ── */
  const [tradeMode, setTradeMode] = useState({ option:'weekly', stock:'intraday' })
  const [tradeList, setTradeList] = useState([])

  /* ── News ── */
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(true)

  /* ── Portfolio ── */
  const [port, setPort] = useState(() => {
    const cap = cfg.capital || 5000000
    return { cash:cap, startEq:cap, equity:cap, positions:{}, trades:[], pnl:0 }
  })

  /* ── UI ── */
  const [toasts, setToasts] = useState([])
  const [killed, setKilled] = useState(false)
  const [clock, setClock] = useState(ts())

  /* ── Screener ── */
  const [screenerData, setScreenerData] = useState([])
  const [screenerLoading, setScreenerLoading] = useState(false)
  const [screenerFilter, setScreenerFilter] = useState('all')

  /* ─── Derived ─── */
  const activeSym = ALL_SYMBOLS.find(s => s.symbol === activeSymbol) || ALL_INDICES[0]
  const activePrice = prices[activeSymbol]?.cur || SPOT_REF[activeSymbol] || 10000
  const activeChainW = chains[activeSymbol]?.weekly
  const activeChainM = chains[activeSymbol]?.monthly
  const activeChain  = chainExpType === 'weekly' ? activeChainW : activeChainM
  const ddPct = Math.max(0, (port.startEq - port.equity) / port.startEq * 100)

  /* ─── Toast ─── */
  const addToast = useCallback((type, icon, title, msg) => {
    const id = Date.now() + Math.random()
    setToasts(p => [...p.slice(-5), { id, type, icon, title, msg }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000)
  }, [])

  /* ─── Save config ─── */
  const saveCfg = useCallback(nc => {
    setCfg(nc); localStorage.setItem('aladdin_v5_cfg', JSON.stringify(nc))
    addToast('success','⚙','Config Saved','Settings updated')
  }, [addToast])

  /* ─── Clock (1s) ─── */
  useEffect(() => {
    const iv = setInterval(() => { setClock(ts()); setMktStatus(marketStatus()) }, 1000)
    return () => clearInterval(iv)
  }, [])

  /* ─── Kill switch ─── */
  useEffect(() => {
    if (ddPct >= 5 && !killed) {
      setKilled(true)
      addToast('error','🔴','KILL SWITCH','5% drawdown — all trading halted')
    }
  }, [ddPct, killed, addToast])

  /* ─── Price fetching (5s batches) ─── */
  useEffect(() => {
    const allIds = ALL_INDICES.map(i=>i.symbol)
    const stockIds = FNO_STOCKS.slice(0,30)
    let batchIdx = 0; let turn = 0

    const fetchBatch = async () => {
      try {
        // Alternate between NSE API and YF
        if (turn % 3 === 0) {
          // NSE market data
          const md = await fetchMarketData()
          if (md.ok) {
            setVix(md.indiaVix)
            setFiiDii(md.fiiDii || [])
            setAllNseIndices(md.allIndices || [])
            setPrices(prev => {
              const next = { ...prev }; const fl = {}
              Object.entries(md.indexData || {}).forEach(([sym, q]) => {
                if (!q) return
                if (prev[sym]?.cur && Math.abs(q.last - prev[sym].cur) > 0.01) fl[sym] = q.last > prev[sym].cur ? 'up' : 'dn'
                next[sym] = { cur:q.last||prev[sym]?.cur||0, open:q.open||0, high:q.high||0, low:q.low||0, prev:q.previousClose||0, chg:q.change||0, pct:q.pChange||0, vol:0, live:true }
              })
              applyFlashes(fl); return next
            })
          }
        } else {
          // YF batch
          const batch = turn % 3 === 1 ? allIds : stockIds.slice(batchIdx, batchIdx+8)
          if (turn % 3 === 2) batchIdx = (batchIdx + 8) % stockIds.length
          const live = await fetchYFQuotes(batch)
          if (Object.keys(live).length) {
            setPrices(prev => {
              const next = { ...prev }; const fl = {}
              Object.entries(live).forEach(([id, q]) => {
                if (prev[id]?.cur && Math.abs(q.cur-prev[id].cur)>0.01) fl[id]=q.cur>prev[id].cur?'up':'dn'
                next[id] = { ...prev[id], ...q }
              })
              applyFlashes(fl); return next
            })
          }
        }
      } catch { /* ignore */ }
      turn++
    }

    const applyFlashes = fl => {
      if (!Object.keys(fl).length) return
      setFlashMap(f=>({...f,...fl}))
      setTimeout(()=>setFlashMap(f=>{const c={...f};Object.keys(fl).forEach(k=>delete c[k]);return c}),700)
    }

    fetchBatch()
    const iv = setInterval(fetchBatch, 5000)
    return () => clearInterval(iv)
  }, [])

  /* ─── Build option chains for active symbol ─── */
  useEffect(() => {
    let cancelled = false
    const buildChains = async () => {
      const spot = prices[activeSymbol]?.cur || SPOT_REF[activeSymbol] || 10000
      // Try live NSE first
      let liveChain = null
      try {
        const raw = await fetchNSEOptionChain(activeSymbol)
        if (raw?.records?.data) {
          const expiries = raw.records.expiryDates || []
          const wExp = expiries[0] || ''
          const mExp = expiries.find(e => {
            const d = new Date(e)
            const m = getDaysToExpiry('monthly')
            return Math.abs((d - new Date())/86400000 - m) < 15
          }) || expiries[expiries.length > 3 ? 2 : expiries.length-1] || wExp

          const makeChain = (expiry, type) => {
            const data = raw.records.data.filter(d => d.expiryDate === expiry)
            const underlying = raw.records.underlyingValue || spot
            const atm = Math.round(underlying / (activeSym.strikeStep||50)) * (activeSym.strikeStep||50)
            const rows = data.map(d => ({
              strike: d.strikePrice,
              isATM: d.strikePrice === atm,
              isITM_CE: d.strikePrice < underlying,
              isITM_PE: d.strikePrice > underlying,
              ce: { px:d.CE?.lastPrice||0, oi:d.CE?.openInterest||0, chgOI:d.CE?.changeinOpenInterest||0,
                    vol:d.CE?.totalTradedVolume||0, chgPct:d.CE?.pChange||0, iv:d.CE?.impliedVolatility||0,
                    ...calcGreeks(underlying,d.strikePrice,getDaysToExpiry(type)/365,RF,(d.CE?.impliedVolatility||18)/100,'CE') },
              pe:  { px:d.PE?.lastPrice||0, oi:d.PE?.openInterest||0, chgOI:d.PE?.changeinOpenInterest||0,
                    vol:d.PE?.totalTradedVolume||0, chgPct:d.PE?.pChange||0, iv:d.PE?.impliedVolatility||0,
                    ...calcGreeks(underlying,d.strikePrice,getDaysToExpiry(type)/365,RF,(d.PE?.impliedVolatility||18)/100,'PE') },
            })).sort((a,b)=>a.strike-b.strike)
            const totalCE = rows.reduce((s,r)=>s+(r.ce?.oi||0),0)
            const totalPE = rows.reduce((s,r)=>s+(r.pe?.oi||0),0)
            const pcr = totalPE/(totalCE||1)
            const maxPain = calcMaxPain(rows)
            const ceResist = rows.reduce((b,r)=>r.ce?.oi>b.oi?{strike:r.strike,oi:r.ce?.oi}:b,{strike:0,oi:0})
            const peSupport= rows.reduce((b,r)=>r.pe?.oi>b.oi?{strike:r.strike,oi:r.pe?.oi}:b,{strike:0,oi:0})
            return { rows:rows.slice(Math.max(0,rows.findIndex(r=>r.isATM)-8), rows.findIndex(r=>r.isATM)+9), atm, pcr:+pcr.toFixed(2), maxPain, ceResist, peSupport, totalCE, totalPE, daysToExp:getDaysToExpiry(type), live:true }
          }
          liveChain = { weekly: makeChain(wExp,'weekly'), monthly: makeChain(mExp,'monthly') }
        }
      } catch { /* fallback */ }

      if (!cancelled) {
        const weekly  = liveChain?.weekly  || buildOptionChain(spot, activeSymbol, getDaysToExpiry('weekly'))
        const monthly = liveChain?.monthly || buildOptionChain(spot, activeSymbol, getDaysToExpiry('monthly'))
        setChains(p => ({ ...p, [activeSymbol]: { weekly, monthly } }))
      }
    }
    buildChains()
    const iv = setInterval(buildChains, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [activeSymbol, prices[activeSymbol]?.cur])

  /* ─── Generate option signals ─── */
  useEffect(() => {
    const gen = () => {
      const newSigs = {}
      ALL_INDICES.forEach(idx => {
        const spot = prices[idx.symbol]?.cur || SPOT_REF[idx.symbol] || 10000
        const chain_w = chains[idx.symbol]?.weekly || buildOptionChain(spot, idx.symbol, getDaysToExpiry('weekly'))
        const chain_m = chains[idx.symbol]?.monthly || buildOptionChain(spot, idx.symbol, getDaysToExpiry('monthly'))

        const genSig = (chain, expType) => {
          if (!chain) return null
          const hist = priceHistRef.current[idx.symbol]?.prices || []
          const sm50 = hist.length >= 50 ? hist.slice(-50).reduce((s,v)=>s+v,0)/50 : spot * 0.975
          const rsiArr = hist.length >= 15 ? rsi(hist.slice(-30), 14) : []
          const rsiVal = rsiArr.at(-1) || 50
          const side = (spot > sm50 && rsiVal < 65) ? 'BUY' : (spot < sm50 && rsiVal > 35) ? 'SELL' : (chain.pcr > 1.1 ? 'BUY' : chain.pcr < 0.9 ? 'SELL' : 'BUY')
          const isBull = side === 'BUY'
          const atm = chain.atm
          const strike = atm
          const optType = isBull ? 'CE' : 'PE'
          const T = chain.daysToExp / 365
          const iv = 0.15 + (vix||16)/200
          const prem = Math.max(0.5, bsApprox(spot, strike, T, RF, iv, optType))
          const g = calcGreeks(spot, strike, T, RF, iv, optType)
          const atrVal = spot * 0.008
          const tgt = isBull ? prem + atrVal * Math.abs(g.delta) * 2.5 : prem + atrVal * Math.abs(g.delta) * 2.5
          const sl  = Math.max(0.5, prem - atrVal * Math.abs(g.delta) * 1.1)
          const score = Math.min(95, 65 + (rsiVal < 35 || rsiVal > 65 ? 15 : 0) + (chain.pcr > 1.2 || chain.pcr < 0.8 ? 10 : 0) + Math.round(Math.random()*5))
          return {
            symbol: idx.symbol, strike, optType, expType, side,
            buyAt: +prem.toFixed(2), stoploss: +sl.toFixed(2), sellAt: +tgt.toFixed(2),
            delta: g.delta, theta: g.theta, vega: g.vega, iv: g.iv,
            pcr: chain.pcr, maxPain: chain.maxPain,
            ceResist: chain.ceResist?.strike, peSupport: chain.peSupport?.strike,
            lot: idx.lot, daysToExp: chain.daysToExp, score,
            pattern: 'Trend + OI Analysis', rsi: rsiVal.toFixed(1),
          }
        }
        newSigs[idx.symbol] = {
          weekly:  genSig(chain_w, 'weekly'),
          monthly: genSig(chain_m, 'monthly'),
        }
      })
      setOptionSignals(prev => ({ ...prev, ...newSigs }))
    }
    gen()
    const iv = setInterval(gen, 25000)
    return () => clearInterval(iv)
  }, [chains, prices, vix])

  /* ─── Candles + stock signals ─── */
  useEffect(() => {
    let cancelled = false
    const loadCandles = async () => {
      const sym = activeSym
      const yfSym = sym.symbol
      const cv = await fetchYFChart(yfSym).catch(()=>null)
      if (!cv || cancelled) return
      const closes = cv.map(c=>c.close)
      if (!priceHistRef.current[activeSymbol]) priceHistRef.current[activeSymbol] = { prices:[], volumes:[] }
      const hist = priceHistRef.current[activeSymbol]
      hist.prices = closes
      hist.volumes = cv.map(c=>c.vol||1000000)
      if (closes.length >= 20) {
        const sig = generateSignal(closes.at(-1), closes, hist.volumes, sym.strikeStep||50, sym.type==='index')
        if (!cancelled && sig) setStockSignals(p=>({...p,[activeSymbol]:sig}))
      }
    }
    loadCandles()
    const iv = setInterval(loadCandles, 60000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [activeSymbol])

  /* ─── Generate trade mode list ─── */
  useEffect(() => {
    const list = []
    const optExpType = tradeMode.option
    ALL_INDICES.forEach(idx => {
      const sig = optionSignals[idx.symbol]?.[optExpType]
      if (sig) list.push({ type:'option', ...sig, expType:optExpType })
    })
    // Add some stock picks from stock signals
    FNO_STOCKS.slice(0, 20).forEach(sym => {
      const sig = stockSignals[sym]
      const price = prices[sym]?.cur
      if (sig && price && sig.action !== 'HOLD') {
        const isBull = sig.action === 'BUY'
        const optExpType2 = tradeMode.option
        const daysExp = getDaysToExpiry(optExpType2)
        const step = getStrikeStep(sym)
        const atm = Math.round(price/step)*step
        const T = daysExp/365
        const iv = 0.20
        const prem = Math.max(0.5, bsApprox(price, atm, T, RF, iv, isBull?'CE':'PE'))
        const g = calcGreeks(price, atm, T, RF, iv, isBull?'CE':'PE')
        list.push({
          type: 'option', symbol:sym, strike:atm,
          optType:isBull?'CE':'PE', expType:optExpType2, side:sig.action,
          buyAt:+prem.toFixed(2), stoploss:+(prem*0.65).toFixed(2), sellAt:+(prem*1.8).toFixed(2),
          delta:g.delta, theta:g.theta, iv:g.iv,
          pcr:1.0, maxPain:atm, ceResist:atm+step*2, peSupport:atm-step*2,
          lot:getLot(sym), daysToExp:daysExp, score:sig.confidence,
          pattern:sig.patterns?.[0]||'Technical Signal',
        })
      }
    })
    setTradeList(list)
  }, [optionSignals, stockSignals, tradeMode, prices])

  /* ─── News fetching ─── */
  useEffect(() => {
    const load = async () => {
      setNewsLoading(true)
      try {
        const [n1, n2] = await Promise.allSettled([fetchNSENews(), fetchRSSNews()])
        const all = [
          ...(n1.status==='fulfilled'?n1.value:[]),
          ...(n2.status==='fulfilled'?n2.value:[]),
        ].sort((a,b) => new Date(b.time)-new Date(a.time))
        if (all.length) setNews(all)
      } finally { setNewsLoading(false) }
    }
    load()
    const iv = setInterval(load, 60000)
    return () => clearInterval(iv)
  }, [])

  /* ─── Screener data ─── */
  useEffect(() => {
    if (page !== 'screener') return
    setScreenerLoading(true)
    const build = async () => {
      const rows = await Promise.all(FNO_STOCKS.slice(0,40).map(async sym => {
        const price = prices[sym]?.cur || SPOT_REF[sym] || 100
        const sig = stockSignals[sym]
        let pe = null, mcap = null
        // Try YF for fundamentals
        try {
          const d = await fetchYFQuotes([sym])
          mcap = d[sym]?.mcap || null
        } catch {}
        return {
          sym, price, chg: prices[sym]?.chg||0, pct: prices[sym]?.pct||0,
          vol: prices[sym]?.vol||0, pe, mcap,
          action: sig?.action||'HOLD', confidence: sig?.confidence||50,
          entry: sig?.entry||price, sl: sig?.stopLoss||price*0.97,
          t1: sig?.target1||price*1.02, t2: sig?.target2||price*1.04,
          rsi: sig?.rsi||50, patterns: sig?.patterns||[],
          optRec: sig?.optionRecommendation||null,
        }
      }))
      setScreenerData(rows)
      setScreenerLoading(false)
    }
    build()
  }, [page, prices, stockSignals])

  /* ─── Execute paper trade ─── */
  const execTrade = useCallback((sig, side, isOption) => {
    if (killed) { addToast('error','🔴','KILLED','Kill switch active'); return }
    const price = isOption ? sig.buyAt : sig.price || sig.entry
    const lot = sig.lot || 1
    const tradeVal = port.equity * 0.015
    const qty = Math.max(1, Math.floor(tradeVal / (price * lot))) * lot
    const cost = qty * price
    if (cost > port.cash) { addToast('warning','💰','Insufficient Funds', fmt(cost,0)); return }
    setPort(p => {
      const pos = { ...p.positions }
      const key = isOption ? `${sig.symbol}${sig.strike}${sig.optType}` : sig.symbol
      pos[key] = (pos[key]||0) + (side==='SELL'?-qty:qty)
      const cash = p.cash - cost
      const equity = cash + Object.values(pos).reduce((s,q)=>s+Math.abs(q)*price,0)
      const trade = { id:Date.now(), sym:key, side, qty:Math.floor(qty/lot), lots:Math.floor(qty/lot), px:price, sl:isOption?sig.stoploss:sig.sl, tgt:isOption?sig.sellAt:sig.t1, time:ts(), type:isOption?'option':'stock', pnl:0 }
      addToast('success', side==='BUY'?'📈':'📉', `${side} EXECUTED`, `${key} @ ₹${price} · ${trade.lots} lot(s)`)
      return { ...p, cash, equity, positions:pos, trades:[trade,...p.trades].slice(0,100), pnl:equity-p.startEq }
    })
  }, [killed, port, addToast])

  /* ─── Index tab price display ─── */
  const renderIndexTab = (idx) => {
    const p = prices[idx.symbol], u = (p?.chg||0) >= 0
    return (
      <button key={idx.symbol} className={`idx-tab-btn ${activeSymbol===idx.symbol?'active':''}`}
        onClick={() => setActiveSymbol(idx.symbol)} style={{ borderBottom:`2px solid ${activeSymbol===idx.symbol?idx.color:'transparent'}` }}>
        <div className="idx-tab-exch">{idx.exch} · {idx.expDay}</div>
        <div className="idx-tab-name">{idx.name}</div>
        <div className="idx-tab-price" style={{ color:u?'var(--accent-green)':'var(--accent-red)', textShadow:u?'0 0 8px #00ff8866':'0 0 8px #ff446666' }}>
          {(p?.cur||0) >= 1000 ? (p?.cur||0).toFixed(0) : (p?.cur||0).toFixed(2)}
        </div>
        <div className="idx-tab-chg" style={{ color:u?'var(--accent-green)':'var(--accent-red)' }}>
          {u?'▲':'▼'} {Math.abs(p?.pct||0).toFixed(2)}%
        </div>
        <div className="idx-tab-lot">Lot:{idx.lot} · ATM:{Math.round((p?.cur||SPOT_REF[idx.symbol]||0)/(idx.strikeStep||50))*(idx.strikeStep||50)}</div>
      </button>
    )
  }

  /* ─── AI Context ─── */
  const aiContext = useMemo(() => ({
    activeSymbol, spot: activePrice,
    atm: getATM(activePrice, activeSymbol),
    daysToExpiry_w: getDaysToExpiry('weekly'),
    daysToExpiry_m: getDaysToExpiry('monthly'),
    pcr_w: activeChainW?.pcr, pcr_m: activeChainM?.pcr,
    maxPain_w: activeChainW?.maxPain, maxPain_m: activeChainM?.maxPain,
    ceResist: activeChainW?.ceResist?.strike, peSupport: activeChainW?.peSupport?.strike,
    vix, mktStatus,
    weeklyExpiry: getExpiryLabel('weekly'), monthlyExpiry: getExpiryLabel('monthly'),
    fiiNet: fiiDii[0]?.fiiNet, diiNet: fiiDii[0]?.diiNet,
  }), [activeSymbol, activePrice, activeChainW, activeChainM, vix, mktStatus, fiiDii])

  /* ─── NAV LINKS ─── */
  const NAV = [
    { id:'dashboard',    icon:'📊', label:'Dashboard' },
    { id:'option-chain', icon:'⛓',  label:'Option Chain' },
    { id:'ai-signals',   icon:'🤖', label:'AI Signals' },
    { id:'trade-mode',   icon:'🎯', label:'Trade Mode' },
    { id:'charts',       icon:'📈', label:'Charts' },
    { id:'screener',     icon:'🔍', label:'Screener' },
    { id:'institutional',icon:'🏦', label:'Institutional' },
    { id:'ai-brain',     icon:'🧠', label:'AI Brain' },
    { id:'news',         icon:'📰', label:'News' },
    { id:'portfolio',    icon:'💼', label:'Portfolio' },
  ]

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <>
      <div className="cyber-grid"/>
      <div className="scanline"/>
      <Toasts toasts={toasts} dismiss={id=>setToasts(p=>p.filter(t=>t.id!==id))}/>
      {showSettings && <SettingsModal cfg={cfg} onSave={saveCfg} onClose={()=>setShowSettings(false)}/>}
      {killed && (
        <div className="kill-overlay">
          <div className="kill-card">
            <div style={{ fontSize:44, marginBottom:12 }}>⛔</div>
            <div style={{ fontSize:20, fontWeight:800, color:'var(--accent-red)', letterSpacing:2, marginBottom:8 }}>KILL SWITCH ACTIVE</div>
            <div style={{ color:'var(--text-secondary)', marginBottom:20 }}>Daily drawdown ≥ 5% — All trading halted</div>
            <button className="btn-cyber" onClick={()=>{ setKilled(false); addToast('info','⚡','Resumed','Kill switch overridden') }}>MANUAL OVERRIDE</button>
          </div>
        </div>
      )}

      <div className="app-root">
        {/* ══ SIDEBAR ══ */}
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-logo">⬡ ALADDIN</div>
            <div className="sidebar-sub">NSE · BSE · F&O v5</div>
          </div>
          <nav className="sidebar-nav">
            {NAV.map(n => (
              <button key={n.id} className={`nav-link ${page===n.id?'active':''}`} onClick={()=>setPage(n.id)}>
                <span>{n.icon}</span><span>{n.label}</span>
              </button>
            ))}
            <div style={{ marginTop:10, padding:'8px 10px', background:'rgba(0,212,255,.06)', border:'1px solid var(--border-cyber)', borderRadius:4, fontSize:9, color:'var(--text-secondary)' }}>
              <div style={{ fontWeight:700, color:'var(--accent-cyan)', marginBottom:2 }}>PORTFOLIO</div>
              <div>Equity: <span style={{ color:port.pnl>=0?'var(--accent-green)':'var(--accent-red)', fontWeight:700 }}>{fmt(port.equity,0)}</span></div>
              <div>P&L: <span style={{ color:port.pnl>=0?'var(--accent-green)':'var(--accent-red)', fontWeight:700 }}>{fmt(port.pnl,0)}</span></div>
            </div>
          </nav>
          <div className="sidebar-footer">
            <div className="ist-clock">
              <div className={`clock-dot ${mktStatus==='OPEN'?'open':mktStatus==='PRE'?'pre':'closed'}`}/>
              <div>
                <div className="clock-time">{clock} IST</div>
                <div className="clock-status" style={{ color:mktStatus==='OPEN'?'var(--accent-green)':mktStatus==='PRE'?'var(--accent-gold)':'var(--accent-red)' }}>
                  {mktStatus}
                </div>
              </div>
            </div>
            <button className="btn-cyber" style={{ width:'100%', marginTop:8, padding:'4px', fontSize:9 }} onClick={()=>setShowSettings(true)}>⚙ SETTINGS</button>
          </div>
        </aside>

        {/* ══ MAIN CONTENT ══ */}
        <main className="main-content">
          {/* Page header with index tabs + ticker */}
          <div style={{ position:'sticky', top:0, zIndex:50, background:'rgba(5,10,18,.98)', borderBottom:'1px solid var(--border-cyber)' }}>
            {/* Index tabs row */}
            <div className="idx-header-tabs">
              {ALL_INDICES.map(renderIndexTab)}
              {/* Right controls */}
              <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'0 12px', flexShrink:0 }}>
                {vix !== null && (
                  <div style={{ textAlign:'center', borderRight:'1px solid var(--border-cyber)', paddingRight:10 }}>
                    <div style={{ fontSize:7, color:'var(--text-dim)' }}>INDIA VIX</div>
                    <div style={{ fontSize:13, fontWeight:800, color:vix>20?'var(--accent-red)':vix>15?'var(--accent-gold)':'var(--accent-green)', fontFamily:'Orbitron,monospace' }}>{vix?.toFixed(2)}</div>
                  </div>
                )}
                <div style={{ textAlign:'center', borderRight:'1px solid var(--border-cyber)', paddingRight:10 }}>
                  <div style={{ fontSize:7, color:'var(--text-dim)' }}>W-EXP</div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--accent-gold)' }}>{getDaysToExpiry('weekly')}D</div>
                </div>
                <div style={{ textAlign:'center', borderRight:'1px solid var(--border-cyber)', paddingRight:10 }}>
                  <div style={{ fontSize:7, color:'var(--text-dim)' }}>M-EXP</div>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--accent-purple)' }}>{getDaysToExpiry('monthly')}D</div>
                </div>
                <button className={`btn-cyber ${mktStatus==='OPEN'?'glow-border-green':''}`} style={{ fontSize:9, padding:'4px 10px' }} onClick={()=>setShowSettings(true)}>⚙</button>
              </div>
            </div>
            {/* Ticker marquee */}
            <div className="ticker-wrap" style={{ height:26 }}>
              <div className="ticker-track">
                {[...FNO_STOCKS.slice(0,30),...FNO_STOCKS.slice(0,30)].map((sym,i) => {
                  const p = prices[sym], u = (p?.chg||0) >= 0, fl = flashMap[sym]
                  return (
                    <span key={i} className={`ticker-item ${activeSymbol===sym?'active':''} ${fl==='up'?'price-up':fl==='dn'?'price-down':''}`}
                      onClick={()=>setActiveSymbol(sym)} style={{ fontSize:11 }}>
                      <span style={{ color:CAT_COLORS.IT, fontWeight:700, fontSize:10 }}>{sym}</span>
                      <span style={{ color:u?'var(--accent-green)':'var(--accent-red)', fontWeight:700 }}>
                        ₹{(p?.cur||SPOT_REF[sym]||0)>=100?(p?.cur||SPOT_REF[sym]||0).toFixed(0):(p?.cur||SPOT_REF[sym]||0).toFixed(1)}
                      </span>
                      <span style={{ color:u?'var(--accent-green)':'var(--accent-red)', fontSize:9 }}>{u?'▲':'▼'}{Math.abs(p?.pct||0).toFixed(2)}%</span>
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* PAGE CONTENT */}
          <div style={{ padding: '10px 14px' }}>

            {/* ════ DASHBOARD ════ */}
            {page === 'dashboard' && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div style={{ fontFamily:'Orbitron,monospace', fontSize:16, fontWeight:700, color:'var(--accent-cyan)' }}>TradeIQ Pro Dashboard</div>
                    <div style={{ fontSize:10, color:'var(--text-secondary)' }}>Live NSE·BSE F&O Terminal · {mktStatus} · {clock} IST</div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <span className={`badge ${port.pnl>=0?'badge-buy':'badge-sell'}`} style={{ fontSize:11 }}>P&L: {fmt(port.pnl,0)}</span>
                    <span className="badge badge-neutral">VIX: {vix?.toFixed(2)||'—'}</span>
                  </div>
                </div>

                {/* Top metrics row */}
                <div className="dashboard-grid-4" style={{ marginBottom:12 }}>
                  {[
                    { l:'Portfolio', v:fmt(port.equity,0), sub:`${fmtPct((port.pnl/port.startEq)*100)} return`, c:port.pnl>=0?'var(--accent-green)':'var(--accent-red)' },
                    { l:'Cash Available', v:fmt(port.cash,0), sub:'1.5% max per trade', c:'var(--accent-cyan)' },
                    { l:'Drawdown', v:`${ddPct.toFixed(2)}%`, sub:'Kill switch at 5%', c:ddPct>3?'var(--accent-red)':'var(--accent-gold)' },
                    { l:'FII Net Today', v:fiiDii[0]?fmt(fiiDii[0].fiiNet/100,0)+'Cr':'—', sub:'Institutional flow', c:(fiiDii[0]?.fiiNet||0)>=0?'var(--accent-green)':'var(--accent-red)' },
                  ].map(m => (
                    <div key={m.l} className="glass-panel" style={{ padding:'12px 14px' }}>
                      <div style={{ fontSize:9, color:'var(--text-secondary)', letterSpacing:1 }}>{m.l}</div>
                      <div style={{ fontSize:18, fontWeight:800, color:m.c, fontFamily:'Orbitron,monospace', marginTop:2 }}>{m.v}</div>
                      <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:2 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Active signal + chain side by side */}
                <div className="dashboard-grid" style={{ marginBottom:12 }}>
                  {/* Weekly option signal */}
                  <div className="glass-panel" style={{ padding:'12px 14px' }}>
                    <div className="section-header">
                      WEEKLY SIGNAL — {activeSymbol} <span className="dot-live"/>
                    </div>
                    {optionSignals[activeSymbol]?.weekly
                      ? <OptionSignalCard sig={optionSignals[activeSymbol].weekly} onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/>
                      : <div style={{ color:'var(--text-dim)', fontSize:10, display:'flex', alignItems:'center', gap:6, padding:10 }}><span className="loader"/>Generating signal...</div>}
                  </div>
                  {/* Monthly option signal */}
                  <div className="glass-panel" style={{ padding:'12px 14px' }}>
                    <div className="section-header">MONTHLY SIGNAL — {activeSymbol}</div>
                    {optionSignals[activeSymbol]?.monthly
                      ? <OptionSignalCard sig={optionSignals[activeSymbol].monthly} onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/>
                      : <div style={{ color:'var(--text-dim)', fontSize:10, display:'flex', alignItems:'center', gap:6, padding:10 }}><span className="loader"/>Generating signal...</div>}
                  </div>
                  {/* PCR + institutional */}
                  <div className="glass-panel" style={{ padding:'12px 14px' }}>
                    <div className="section-header">OPTION CHAIN METRICS</div>
                    {activeChain && <PCRBar pcr={activeChain.pcr} maxPain={activeChain.maxPain} ceResist={activeChain.ceResist} peSupport={activeChain.peSupport} atm={activeChain.atm}/>}
                    <div style={{ fontSize:9, color:'var(--text-secondary)', marginTop:8, marginBottom:6, letterSpacing:1, fontWeight:700 }}>RECENT NEWS</div>
                    {news.slice(0,4).map((n,i) => (
                      <div key={i} className="monitor-item">
                        <div className="title">{n.title?.slice(0,100)}</div>
                        <div className="meta">
                          <span style={{ color:'var(--accent-cyan)' }}>{n.source}</span>
                          <span className={`sent-${n.sentiment==='positive'?'pos':n.sentiment==='negative'?'neg':'neu'}`}>{n.sentiment}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* All indices grid */}
                <div className="glass-panel" style={{ padding:'12px 14px', marginBottom:12 }}>
                  <div className="section-header">ALL INDICES — LIVE <span className="dot-live"/></div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:6 }}>
                    {ALL_INDICES.map(idx => {
                      const p = prices[idx.symbol], u=(p?.chg||0)>=0
                      const sig = optionSignals[idx.symbol]?.weekly
                      return (
                        <div key={idx.symbol} className="glass-panel" style={{ padding:'10px 12px', cursor:'pointer', borderLeft:`3px solid ${idx.color}` }}
                          onClick={()=>{ setActiveSymbol(idx.symbol); setPage('option-chain') }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                            <div>
                              <div style={{ fontSize:9, color:idx.color, fontWeight:800, letterSpacing:1 }}>{idx.name}</div>
                              <div style={{ fontSize:18, fontWeight:900, fontFamily:'Orbitron,monospace', color:u?'var(--accent-green)':'var(--accent-red)' }}>
                                {(p?.cur||0)>=1000?(p?.cur||0).toFixed(0):(p?.cur||0).toFixed(2)}
                              </div>
                              <div style={{ fontSize:10, color:u?'var(--accent-green)':'var(--accent-red)' }}>{u?'▲':'▼'}{Math.abs(p?.pct||0).toFixed(2)}%</div>
                            </div>
                            {sig && <span className={sig.side==='BUY'?'badge-buy badge':'badge-sell badge'} style={{ fontSize:8 }}>
                              {sig.side} {sig.strike}{sig.optType}
                            </span>}
                          </div>
                          {sig && <div style={{ marginTop:5, fontSize:9, color:'var(--text-secondary)' }}>
                            Buy:₹<strong style={{ color:'var(--accent-green)' }}>{sig.buyAt}</strong> · SL:₹<strong style={{ color:'var(--accent-red)' }}>{sig.stoploss}</strong> · Tgt:₹<strong style={{ color:'gold' }}>{sig.sellAt}</strong>
                          </div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ════ OPTION CHAIN ════ */}
            {page === 'option-chain' && (
              <div>
                <div className="page-header" style={{ position:'relative', marginBottom:10, borderRadius:6 }}>
                  <div>
                    <div className="page-title">OPTION CHAIN — {activeSymbol}</div>
                    <div className="page-sub">Live NSE data · {activeChain?.live?'NSE LIVE':'Calculated'} · ATM {activeChain?.atm}</div>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <div className="tab-bar">
                      {['weekly','monthly'].map(t=>(
                        <button key={t} className={`tab-btn ${chainExpType===t?'active':''}`} onClick={()=>setChainExpType(t)}>
                          {t.toUpperCase()} ({getDaysToExpiry(t)}D)
                        </button>
                      ))}
                    </div>
                    <button className="btn-cyber" style={{ fontSize:9, padding:'4px 10px' }} onClick={()=>setShowGreeks(g=>!g)}>
                      {showGreeks?'HIDE':'SHOW'} GREEKS
                    </button>
                  </div>
                </div>

                {/* PCR bar */}
                {activeChain && <PCRBar pcr={activeChain.pcr} maxPain={activeChain.maxPain} ceResist={activeChain.ceResist} peSupport={activeChain.peSupport} atm={activeChain.atm}/>}

                {/* Signal for this chain */}
                {optionSignals[activeSymbol]?.[chainExpType] && (
                  <div style={{ marginBottom:10 }}>
                    <OptionSignalCard sig={optionSignals[activeSymbol][chainExpType]} onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/>
                  </div>
                )}

                {/* Chain table */}
                <div className="glass-panel" style={{ padding:'10px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ fontSize:9, letterSpacing:1.5, color:'var(--accent-cyan)', fontWeight:800 }}>
                      OPTION CHAIN · {activeSymbol} · {chainExpType.toUpperCase()} ({getExpiryLabel(chainExpType)})
                    </div>
                    <div style={{ display:'flex', gap:8, fontSize:9 }}>
                      <span style={{ color:'var(--accent-green)' }}>CE Total OI: {fmtN(activeChain?.totalCE||0)}</span>
                      <span style={{ color:'var(--accent-red)' }}>PE Total OI: {fmtN(activeChain?.totalPE||0)}</span>
                    </div>
                  </div>
                  <OptionChainTable chain={activeChain} spot={activePrice} showGreeks={showGreeks}
                    onStrikeClick={row => {
                      const type = activePrice > row.strike ? 'CE' : 'PE'
                      const T = getDaysToExpiry(chainExpType)/365
                      const iv = (row[type.toLowerCase()]?.iv||18)/100
                      const prem = type==='CE'?row.ce?.px:row.pe?.px
                      const g = type==='CE'?row.ce:row.pe
                      addToast('info','📍','Strike Selected',`${activeSymbol} ${row.strike}${type} @ ₹${prem} · Δ${g?.delta||'—'} · IV${g?.iv||'—'}%`)
                    }}/>
                </div>

                {/* All indices option signals grid */}
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'var(--accent-cyan)', letterSpacing:2, marginBottom:10 }}>ALL INDEX OPTION SIGNALS — {chainExpType.toUpperCase()}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:8 }}>
                    {ALL_INDICES.map(idx => {
                      const sig = optionSignals[idx.symbol]?.[chainExpType]
                      return sig ? <OptionSignalCard key={idx.symbol} sig={sig} compact onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/> : null
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ════ AI SIGNALS ════ */}
            {page === 'ai-signals' && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div className="page-title">🤖 AI SIGNALS — ALL F&O STOCKS & INDICES</div>
                    <div className="page-sub">Technical analysis · RSI · MACD · BB · 30+ candlestick patterns · Updated every 60s</div>
                  </div>
                  <div style={{ display:'flex', gap:8, fontSize:11 }}>
                    <span style={{ background:'rgba(0,255,136,.15)', color:'var(--accent-green)', padding:'3px 10px', borderRadius:4, border:'1px solid #0f86' }}>
                      {Object.values(stockSignals).filter(s=>s?.action==='BUY').length} BUY
                    </span>
                    <span style={{ background:'rgba(255,68,102,.15)', color:'var(--accent-red)', padding:'3px 10px', borderRadius:4, border:'1px solid #f466' }}>
                      {Object.values(stockSignals).filter(s=>s?.action==='SELL').length} SELL
                    </span>
                    <span style={{ background:'rgba(255,215,0,.15)', color:'var(--accent-gold)', padding:'3px 10px', borderRadius:4, border:'1px solid #ffd70066' }}>
                      {Object.values(stockSignals).filter(s=>s?.action==='HOLD').length} HOLD
                    </span>
                  </div>
                </div>

                {/* Index option signals */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'var(--accent-cyan)', letterSpacing:2, marginBottom:10 }}>INDEX OPTION SIGNALS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(310px,1fr))', gap:8 }}>
                    {ALL_INDICES.map(idx => {
                      const sigW = optionSignals[idx.symbol]?.weekly
                      const sigM = optionSignals[idx.symbol]?.monthly
                      return (
                        <div key={idx.symbol} className="glass-panel" style={{ padding:'12px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                            <span style={{ color:idx.color, fontWeight:800, fontSize:14 }}>{idx.symbol}</span>
                            <span style={{ fontSize:9, color:'var(--text-secondary)' }}>{idx.name}</span>
                            <span style={{ fontFamily:'Share Tech Mono,monospace', fontSize:13, fontWeight:700, color:(prices[idx.symbol]?.chg||0)>=0?'var(--accent-green)':'var(--accent-red)', marginLeft:'auto' }}>
                              ₹{(prices[idx.symbol]?.cur||0)>=1000?(prices[idx.symbol]?.cur||0).toFixed(0):(prices[idx.symbol]?.cur||0).toFixed(2)}
                            </span>
                          </div>
                          {sigW && <OptionSignalCard sig={sigW} compact onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/>}
                          {sigM && <div style={{ marginTop:4 }}><OptionSignalCard sig={sigM} compact onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/></div>}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* F&O stock signals */}
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'var(--accent-cyan)', letterSpacing:2, marginBottom:10 }}>F&O STOCK SIGNALS — BUY/SELL/HOLD</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:8 }}>
                    {FNO_STOCKS.slice(0,30).map(sym => {
                      const sig = stockSignals[sym]
                      const price = prices[sym]?.cur || SPOT_REF[sym] || 100
                      return <StockSignalCard key={sym} sym={sym} signal={sig} price={price}
                        onBuy={d=>execTrade({...d,...(sig||{}),symbol:sym,entry:price,sl:sig?.stopLoss||price*0.97,t1:sig?.target1||price*1.02,t2:sig?.target2||price*1.04},'BUY',false)}
                        onSell={d=>execTrade({...d,...(sig||{}),symbol:sym,entry:price,sl:sig?.stopLoss||price*0.97,t1:sig?.target1||price*1.02},'SELL',false)}/>
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ════ TRADE MODE ════ */}
            {page === 'trade-mode' && (
              <div>
                <div className="page-title" style={{ marginBottom:6 }}>🎯 TRADE MODE — ALL TRADEABLE INSTRUMENTS</div>
                <div className="page-sub" style={{ marginBottom:14 }}>Select expiry type to filter trades · Click BUY/SELL to paper execute</div>

                {/* Dropdowns */}
                <div style={{ display:'flex', gap:16, marginBottom:16, flexWrap:'wrap' }}>
                  <div className="glass-panel" style={{ padding:'14px 18px', flex:1, minWidth:280 }}>
                    <div style={{ fontSize:9, letterSpacing:2, color:'var(--accent-cyan)', marginBottom:8, fontWeight:800 }}>OPTIONS DROPDOWN</div>
                    <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                      {['intraday','weekly','monthly'].map(t=>(
                        <button key={t} className={`tab-btn ${tradeMode.option===t?'active':''}`} onClick={()=>setTradeMode(p=>({...p,option:t}))} style={{ flex:1 }}>
                          {t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:9, color:'var(--text-secondary)', marginBottom:6 }}>
                      {tradeMode.option==='intraday'?'Same-day expiry · High theta decay · ATM preferred':
                       tradeMode.option==='weekly'?`Expiry: ${getExpiryLabel('weekly')} (${getDaysToExpiry('weekly')}D) · Moderate premium`:
                       `Expiry: ${getExpiryLabel('monthly')} (${getDaysToExpiry('monthly')}D) · Slower theta decay`}
                    </div>
                    <div style={{ fontSize:10, color:'var(--accent-gold)', fontWeight:700 }}>
                      {tradeList.filter(t=>t.type==='option').length} option trades available
                    </div>
                  </div>
                  <div className="glass-panel" style={{ padding:'14px 18px', flex:1, minWidth:280 }}>
                    <div style={{ fontSize:9, letterSpacing:2, color:'var(--accent-green)', marginBottom:8, fontWeight:800 }}>STOCKS DROPDOWN</div>
                    <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                      {['intraday','weekly','monthly'].map(t=>(
                        <button key={t} className={`tab-btn ${tradeMode.stock===t?'active':''}`} onClick={()=>setTradeMode(p=>({...p,stock:t}))} style={{ flex:1 }}>
                          {t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:9, color:'var(--text-secondary)', marginBottom:6 }}>
                      {tradeMode.stock==='intraday'?'Same-day square-off · MIS margin · High volume':
                       tradeMode.stock==='weekly'?'Hold 3-5 days · Swing trades · Breakout/breakdown':
                       'Hold 15-30 days · Positional · Trend following'}
                    </div>
                    <div style={{ fontSize:10, color:'var(--accent-gold)', fontWeight:700 }}>
                      {Object.values(stockSignals).filter(s=>s?.action!=='HOLD').length} stock trades available
                    </div>
                  </div>
                </div>

                {/* Options trade list */}
                <div className="glass-panel" style={{ padding:'12px 14px', marginBottom:12 }}>
                  <div className="section-header">
                    ALL OPTION TRADES — {tradeMode.option.toUpperCase()} <span className="dot-live"/>
                    <span style={{ fontSize:9, color:'var(--text-secondary)' }}>{tradeList.length} trades</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:8 }}>
                    {tradeList.map((sig, i) => (
                      <OptionSignalCard key={i} sig={sig} compact onBuy={s=>execTrade(s,'BUY',true)} onSell={s=>execTrade(s,'SELL',true)}/>
                    ))}
                    {!tradeList.length && <div style={{ color:'var(--text-dim)', fontSize:10, padding:10, gridColumn:'1/-1' }}>Generating trades... please wait.</div>}
                  </div>
                </div>

                {/* Stocks trade list */}
                <div className="glass-panel" style={{ padding:'12px 14px' }}>
                  <div className="section-header">
                    ALL STOCK TRADES — {tradeMode.stock.toUpperCase()} BUY/SELL
                    <span style={{ fontSize:9, color:'var(--text-secondary)' }}>F&O stocks only</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))', gap:8 }}>
                    {FNO_STOCKS.slice(0,30).map(sym => {
                      const sig = stockSignals[sym]
                      const price = prices[sym]?.cur || SPOT_REF[sym] || 100
                      if (!sig || sig.action === 'HOLD') return null
                      return <StockSignalCard key={sym} sym={sym} signal={sig} price={price}
                        onBuy={()=>execTrade({symbol:sym,entry:price,sl:sig?.stopLoss||price*0.97,t1:sig?.target1,t2:sig?.target2,lot:1,buyAt:price,stoploss:sig?.stopLoss,sellAt:sig?.target1},'BUY',false)}
                        onSell={()=>execTrade({symbol:sym,entry:price,sl:sig?.stopLoss||price*1.03,t1:sig?.target1,lot:1,buyAt:price,stoploss:sig?.stopLoss,sellAt:sig?.target1},'SELL',false)}/>
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ════ CHARTS ════ */}
            {page === 'charts' && (
              <div>
                <div className="page-title" style={{ marginBottom:12 }}>📈 CHARTS — ALL 6 INDICES</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {ALL_INDICES.map(idx => (
                    <div key={idx.symbol} className="glass-panel" style={{ overflow:'hidden' }}>
                      <div style={{ padding:'8px 12px', borderBottom:'1px solid var(--border-cyber)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <span style={{ color:idx.color, fontWeight:800, fontSize:13 }}>{idx.symbol}</span>
                          <span style={{ fontSize:9, color:'var(--text-secondary)', marginLeft:8 }}>{idx.name}</span>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:13, fontWeight:800, color:(prices[idx.symbol]?.chg||0)>=0?'var(--accent-green)':'var(--accent-red)', fontFamily:'Share Tech Mono,monospace' }}>
                            {(prices[idx.symbol]?.cur||0)>=1000?(prices[idx.symbol]?.cur||0).toFixed(0):(prices[idx.symbol]?.cur||0).toFixed(2)}
                          </div>
                          <div style={{ fontSize:9, color:(prices[idx.symbol]?.chg||0)>=0?'var(--accent-green)':'var(--accent-red)' }}>
                            {(prices[idx.symbol]?.chg||0)>=0?'▲':'▼'}{Math.abs(prices[idx.symbol]?.pct||0).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <TVChart symbol={idx.symbol} height={250}/>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ════ SCREENER ════ */}
            {page === 'screener' && (
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div className="page-title">🔍 STOCK SCREENER — NSE F&O UNIVERSE</div>
                    <div className="page-sub">Data from Yahoo Finance · NSE India · Live buy/sell/hold signals</div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    {['all','BUY','SELL','HOLD'].map(f => (
                      <button key={f} className={`tab-btn ${screenerFilter===f?'active':''}`} onClick={()=>setScreenerFilter(f)}>{f}</button>
                    ))}
                  </div>
                </div>
                {screenerLoading
                  ? <div style={{ color:'var(--text-dim)', display:'flex', alignItems:'center', gap:8, padding:20 }}><span className="loader"/> Loading screener data from NSE + Yahoo Finance...</div>
                  : (
                  <div className="glass-panel" style={{ padding:'10px 14px', overflowX:'auto' }}>
                    <table className="port-table" style={{ minWidth:900 }}>
                      <thead>
                        <tr>
                          {['SYMBOL','LTP','CHG%','SIGNAL','CONF','ENTRY','STOP LOSS','TARGET 1','TARGET 2','RSI','PATTERNS','OPTION REC','ACTION'].map(h=>(
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {screenerData
                          .filter(r=>screenerFilter==='all'||r.action===screenerFilter)
                          .map(row => (
                          <tr key={row.sym} onClick={()=>{ setActiveSymbol(row.sym); setPage('option-chain') }} style={{ cursor:'pointer' }}>
                            <td style={{ textAlign:'left', fontWeight:800, color:'var(--accent-cyan)' }}>{row.sym}</td>
                            <td style={{ fontFamily:'Share Tech Mono,monospace', fontWeight:700, color:row.chg>=0?'var(--accent-green)':'var(--accent-red)' }}>₹{row.price.toFixed(2)}</td>
                            <td style={{ color:row.pct>=0?'var(--accent-green)':'var(--accent-red)' }}>{fmtPct(row.pct)}</td>
                            <td><span className={row.action==='BUY'?'badge-buy badge':row.action==='SELL'?'badge-sell badge':'badge-hold badge'}>{row.action}</span></td>
                            <td>
                              <div className="conf-bar" style={{ width:60 }}>
                                <div className={`conf-fill ${row.action==='BUY'?'buy':row.action==='SELL'?'sell':'hold'}`} style={{ width:`${row.confidence}%` }}/>
                              </div>
                              <div style={{ fontSize:8, color:'var(--text-dim)' }}>{row.confidence}%</div>
                            </td>
                            <td style={{ fontFamily:'Share Tech Mono,monospace' }}>₹{row.entry?.toFixed(1)||'—'}</td>
                            <td style={{ color:'var(--accent-red)', fontFamily:'Share Tech Mono,monospace' }}>₹{row.sl?.toFixed(1)||'—'}</td>
                            <td style={{ color:'var(--accent-green)', fontFamily:'Share Tech Mono,monospace' }}>₹{row.t1?.toFixed(1)||'—'}</td>
                            <td style={{ color:'var(--accent-green)', fontFamily:'Share Tech Mono,monospace' }}>₹{row.t2?.toFixed(1)||'—'}</td>
                            <td style={{ color:row.rsi>70?'var(--accent-red)':row.rsi<30?'var(--accent-green)':'var(--text-primary)' }}>{row.rsi?.toFixed(0)||'—'}</td>
                            <td style={{ fontSize:9 }}>{row.patterns?.slice(0,2).join(', ')||'—'}</td>
                            <td style={{ fontSize:9 }}>
                              {row.optRec ? <span style={{ color:row.action==='BUY'?'var(--accent-green)':'var(--accent-red)' }}>
                                {row.optRec.strike}{row.optRec.type} ₹{row.optRec.buyPrice}→₹{row.optRec.sellPrice}
                              </span> : '—'}
                            </td>
                            <td>
                              <div style={{ display:'flex', gap:3 }}>
                                <button className="btn-buy" style={{ padding:'2px 8px', fontSize:9 }} onClick={e=>{e.stopPropagation();execTrade({symbol:row.sym,entry:row.price,sl:row.sl,t1:row.t1,lot:1,buyAt:row.entry,stoploss:row.sl,sellAt:row.t1},'BUY',false)}}>BUY</button>
                                <button className="btn-sell" style={{ padding:'2px 8px', fontSize:9 }} onClick={e=>{e.stopPropagation();execTrade({symbol:row.sym,entry:row.price,sl:row.sl,t1:row.t1,lot:1,buyAt:row.entry,stoploss:row.sl,sellAt:row.t1},'SELL',false)}}>SELL</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ════ INSTITUTIONAL ════ */}
            {page === 'institutional' && (
              <div>
                <div className="page-title" style={{ marginBottom:12 }}>🏦 INSTITUTIONAL DATA — FII / DII / INDIA VIX</div>
                <div className="dashboard-grid">
                  <div className="glass-panel" style={{ padding:'14px 16px', gridColumn:'1/-1' }}>
                    <div className="section-header">INSTITUTIONAL FLOWS & INDIA VIX <span className="dot-live"/></div>
                    <InstitutionalPanel fiiDii={fiiDii} vix={vix}/>
                  </div>
                  {/* NSE all indices */}
                  <div className="glass-panel" style={{ padding:'14px 16px', gridColumn:'1/-1' }}>
                    <div className="section-header">ALL NSE INDICES — LIVE DATA</div>
                    <div style={{ overflowX:'auto' }}>
                      <table className="port-table" style={{ minWidth:800 }}>
                        <thead>
                          <tr>{['INDEX','LTP','CHG','CHG%','OPEN','HIGH','LOW','52W HIGH','52W LOW'].map(h=><th key={h}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {allNseIndices.slice(0,30).map((idx,i)=>(
                            <tr key={i}>
                              <td style={{ textAlign:'left', fontSize:10 }}>{idx.name||idx.index}</td>
                              <td style={{ fontFamily:'Share Tech Mono,monospace', fontWeight:700, color:(idx.pChange||idx.percentChange||0)>=0?'var(--accent-green)':'var(--accent-red)' }}>
                                {(idx.last||0).toFixed(2)}
                              </td>
                              <td style={{ color:(idx.variation||idx.change||0)>=0?'var(--accent-green)':'var(--accent-red)' }}>{(idx.variation||idx.change||0).toFixed(2)}</td>
                              <td style={{ color:(idx.pChange||idx.percentChange||0)>=0?'var(--accent-green)':'var(--accent-red)' }}>{fmtPct(idx.pChange||idx.percentChange||0)}</td>
                              <td>{(idx.open||0).toFixed(2)}</td>
                              <td style={{ color:'var(--accent-green)' }}>{(idx.high||0).toFixed(2)}</td>
                              <td style={{ color:'var(--accent-red)' }}>{(idx.low||0).toFixed(2)}</td>
                              <td style={{ color:'var(--accent-green)', fontSize:9 }}>{(idx.yearHigh||0).toFixed(0)}</td>
                              <td style={{ color:'var(--accent-red)', fontSize:9 }}>{(idx.yearLow||0).toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════ AI BRAIN ════ */}
            {page === 'ai-brain' && (
              <div style={{ height:'calc(100vh - 200px)', display:'flex', flexDirection:'column' }}>
                <div style={{ marginBottom:10, flexShrink:0 }}>
                  <div className="page-title">🧠 AI BRAIN — LIVE MARKET ANALYST</div>
                  <div className="page-sub">Claude AI · Ask anything about Indian F&O markets · Live context from NSE/BSE</div>
                  {!cfg.apiKey && (
                    <div style={{ background:'rgba(255,187,0,.08)', border:'1px solid #ffd70044', borderRadius:4, padding:'8px 12px', marginTop:8, fontSize:10, color:'var(--accent-gold)' }}>
                      ⚠ Add Anthropic API key in Settings (⚙) for live AI responses.
                      <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ marginLeft:8, color:'var(--accent-cyan)' }}>Get key →</a>
                    </div>
                  )}
                </div>
                <div className="glass-panel" style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
                  <AIChat apiKey={cfg.apiKey} model={cfg.model||DEFAULT_MODEL} context={aiContext} onAddToast={addToast}/>
                </div>
              </div>
            )}

            {/* ════ NEWS ════ */}
            {page === 'news' && (
              <div>
                <div className="page-title" style={{ marginBottom:12 }}>📰 LIVE MARKET NEWS</div>
                <div className="dashboard-grid-2">
                  <div className="glass-panel" style={{ padding:'12px 14px' }}>
                    <div className="section-header">NSE CORPORATE & MARKET NEWS <span className="dot-live"/></div>
                    {newsLoading && !news.length
                      ? <div style={{ color:'var(--text-dim)', display:'flex', alignItems:'center', gap:6, padding:10 }}><span className="loader"/>Fetching from NSE + ET Markets + NDTV Profit...</div>
                      : news.slice(0,20).map((n,i) => (
                        <div key={i} className="monitor-item">
                          <div className="title">{n.title}</div>
                          {n.summary && n.summary !== n.title && <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:2, lineHeight:1.4 }}>{n.summary?.slice(0,120)}...</div>}
                          <div className="meta">
                            <span style={{ color:'var(--accent-cyan)' }}>{n.source}</span>
                            {n.time && <span style={{ fontSize:8 }}>{new Date(n.time).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}</span>}
                            {n.symbol && <span style={{ color:'var(--accent-gold)' }}>{n.symbol}</span>}
                            <span className={`sent-${n.sentiment==='positive'?'pos':n.sentiment==='negative'?'neg':'neu'}`}>{n.sentiment}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                  <div>
                    <div className="glass-panel" style={{ padding:'12px 14px', marginBottom:10 }}>
                      <div className="section-header">WORLD MONITOR — GLOBAL MARKETS</div>
                      <div style={{ fontSize:9, color:'var(--text-secondary)', marginBottom:8 }}>
                        <a href="https://www.worldmonitor.app/" target="_blank" rel="noreferrer" style={{ fontSize:9 }}>🌐 worldmonitor.app ↗</a>
                        {' · '}
                        <a href="https://economictimes.indiatimes.com/markets" target="_blank" rel="noreferrer" style={{ fontSize:9 }}>ET Markets ↗</a>
                        {' · '}
                        <a href="https://www.moneycontrol.com" target="_blank" rel="noreferrer" style={{ fontSize:9 }}>MoneyControl ↗</a>
                      </div>
                      {[
                        { l:'US Markets', d:'S&P500, Dow, Nasdaq — drives FII flows into India', c:'var(--accent-cyan)' },
                        { l:'Crude Oil', d:'Brent/WTI — impacts ONGC, BPCL, IOC, HPCL', c:'var(--accent-orange)' },
                        { l:'USD/INR', d:'Rupee strength — IT exports (TCS, Infy) & imports', c:'var(--accent-green)' },
                        { l:'SGX Nifty', d:'Pre-market indicator for Nifty open direction', c:'var(--accent-gold)' },
                        { l:'Japan/China', d:'Asian market sentiment — Asian hours FII activity', c:'var(--accent-purple)' },
                        { l:'RBI Policy', d:'Repo rate → Bank Nifty & interest-sensitive stocks', c:'var(--accent-red)' },
                      ].map(g => (
                        <div key={g.l} style={{ padding:'5px 0', borderBottom:'1px solid var(--border-cyber)', fontSize:10 }}>
                          <span style={{ color:g.c, fontWeight:700, marginRight:8 }}>▸ {g.l}:</span>
                          <span style={{ color:'var(--text-secondary)' }}>{g.d}</span>
                        </div>
                      ))}
                    </div>
                    <div className="glass-panel" style={{ padding:'12px 14px' }}>
                      <div className="section-header">ECONOMIC CALENDAR</div>
                      {[
                        { time:'Thu', name:'NIFTY/BANKNIFTY Weekly Expiry', imp:'high', d:'High IV → Option writers active' },
                        { time:'Last Thu', name:'Monthly F&O Expiry', imp:'high', d:'Max pain effect — IV crush post-expiry' },
                        { time:'Monthly', name:'RBI MPC Meeting', imp:'high', d:'Bank Nifty + Fin Nifty sensitive' },
                        { time:'Monthly', name:'CPI/WPI Inflation', imp:'high', d:'Rate cut expectations → broad market' },
                        { time:'Quarterly', name:'Q1/Q2/Q3/Q4 Earnings', imp:'med', d:'Stock-specific IV spikes' },
                        { time:'Monthly', name:'FII/DII Provisional Data', imp:'med', d:'NSE publishes end of session' },
                        { time:'Daily', name:'India VIX Level', imp:'low', d:'VIX>15: sell options / VIX<12: buy options' },
                      ].map((e,i)=>(
                        <div key={i} style={{ display:'flex', gap:8, padding:'6px 0', borderBottom:'1px solid var(--border-cyber)', alignItems:'flex-start' }}>
                          <div style={{ width:6, height:6, borderRadius:'50%', background:e.imp==='high'?'var(--accent-red)':e.imp==='med'?'var(--accent-gold)':'var(--accent-green)', marginTop:4, flexShrink:0 }}/>
                          <div>
                            <div style={{ fontSize:8, color:'var(--accent-gold)', marginBottom:1 }}>{e.time}</div>
                            <div style={{ fontSize:11, fontWeight:600 }}>{e.name}</div>
                            <div style={{ fontSize:9, color:'var(--text-secondary)' }}>{e.d}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════ PORTFOLIO ════ */}
            {page === 'portfolio' && (
              <div>
                <div className="page-title" style={{ marginBottom:12 }}>💼 PAPER PORTFOLIO</div>
                <div className="dashboard-grid-4" style={{ marginBottom:14 }}>
                  {[
                    { l:'Total Equity', v:fmt(port.equity,0), c:port.pnl>=0?'var(--accent-green)':'var(--accent-red)' },
                    { l:'Cash Balance', v:fmt(port.cash,0), c:'var(--accent-cyan)' },
                    { l:'Net P&L', v:fmt(port.pnl,0), c:port.pnl>=0?'var(--accent-green)':'var(--accent-red)' },
                    { l:'Return %', v:fmtPct((port.pnl/port.startEq)*100), c:port.pnl>=0?'var(--accent-green)':'var(--accent-red)' },
                    { l:'Trades', v:port.trades.length, c:'var(--accent-purple)' },
                    { l:'Drawdown', v:`${ddPct.toFixed(2)}%`, c:ddPct>3?'var(--accent-red)':'var(--accent-gold)' },
                    { l:'Starting Capital', v:fmt(port.startEq,0), c:'var(--text-primary)' },
                    { l:'Open Positions', v:Object.keys(port.positions).filter(k=>port.positions[k]!==0).length, c:'var(--accent-cyan)' },
                  ].map(m=>(
                    <div key={m.l} className="glass-panel" style={{ padding:'12px 14px' }}>
                      <div style={{ fontSize:8, color:'var(--text-secondary)', letterSpacing:1 }}>{m.l}</div>
                      <div style={{ fontSize:16, fontWeight:800, color:m.c, fontFamily:'Orbitron,monospace', marginTop:3 }}>{m.v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  <button className="btn-cyber" style={{ fontSize:9, padding:'4px 12px' }}
                    onClick={()=>{ const c=cfg.capital||5000000; setPort({cash:c,startEq:c,equity:c,positions:{},trades:[],pnl:0}); addToast('info','🔄','Reset','Portfolio reset') }}>
                    RESET PORTFOLIO
                  </button>
                </div>

                <div className="glass-panel" style={{ padding:'12px 14px' }}>
                  <div className="section-header">TRADE HISTORY ({port.trades.length})</div>
                  {port.trades.length === 0
                    ? <div style={{ color:'var(--text-dim)', padding:'16px 0', fontSize:10 }}>No trades executed yet. Use any page to paper trade.</div>
                    : (
                    <table className="port-table">
                      <thead>
                        <tr>{['TIME','INSTRUMENT','TYPE','SIDE','LOTS','PRICE','STOP LOSS','TARGET','STATUS'].map(h=><th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {port.trades.map(t=>(
                          <tr key={t.id}>
                            <td style={{ textAlign:'left', fontSize:8, color:'var(--text-dim)' }}>{t.time}</td>
                            <td style={{ textAlign:'left', fontWeight:700 }}>{t.sym}</td>
                            <td><span className="badge badge-neutral" style={{ fontSize:8 }}>{t.type?.toUpperCase()}</span></td>
                            <td style={{ fontWeight:800, color:t.side==='BUY'?'var(--accent-green)':'var(--accent-red)' }}>{t.side}</td>
                            <td>{t.lots}</td>
                            <td style={{ fontFamily:'Share Tech Mono,monospace' }}>₹{t.px}</td>
                            <td style={{ color:'var(--accent-red)' }}>₹{t.sl}</td>
                            <td style={{ color:'var(--accent-gold)' }}>₹{t.tgt}</td>
                            <td><span className="badge badge-buy" style={{ fontSize:7 }}>OPEN</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

          </div>{/* end padding wrapper */}
        </main>
      </div>
    </>
  )
}
