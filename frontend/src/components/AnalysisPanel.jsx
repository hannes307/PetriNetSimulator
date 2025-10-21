// src/components/AnalysisPanel.jsx
import { useEffect, useMemo, useState } from 'react'

export default function AnalysisPanel({
  apiBase = 'http://localhost:8000',
  net,
  marking,                // { [placeId]: number }
  enabledLocal = [],      // local enabled set as fallback
  onClose = () => {},
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [enabled, setEnabled] = useState(enabledLocal || [])
  const [deadlocked, setDeadlocked] = useState((enabledLocal || []).length === 0)
  const [serverMarking, setServerMarking] = useState(marking || {})

  // ----- k-beschränkt / safe (simplified panel) -----
  const [kInput, setKInput] = useState(1)
  const [kLoading, setKLoading] = useState(false)
  const [kError, setKError] = useState('')
  const [kResult, setKResult] = useState(null)

  // Fallback: compute enabled + deadlock locally if backend missing
  const localAnalyze = () => {
    const m = marking || {}
    const places = new Set(net.places.map(p => p.id))
    const trans = new Set(net.transitions.map(t => t.id))
    const inArcs = {}
    net.arcs.forEach(a => {
      if (trans.has(a.dst) && places.has(a.src)) {
        ;(inArcs[a.dst] ||= []).push(a)
      }
    })
    const en = net.transitions
      .filter(t => (inArcs[t.id] || []).every(a => (m[a.src] ?? 0) >= (a.weight ?? 1)))
      .map(t => t.id)
    setEnabled(en)
    setDeadlocked(en.length === 0)
    setServerMarking(m)
  }

  // Load current enabled/deadlock from backend
  useEffect(() => {
    let ignore = false
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${apiBase}/analyze/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ net, marking }),
        })
        if (!res.ok) { localAnalyze(); return }
        const data = await res.json()
        if (ignore) return
        setEnabled(data.enabled || [])
        setDeadlocked(!!data.deadlocked || (data.enabled || []).length === 0)
        setServerMarking(data.marking || marking || {})
      } catch {
        if (!ignore) localAnalyze()
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, JSON.stringify(net), JSON.stringify(marking)])

  // Call /analyze/kbounded (backend returns global + per-place maxima)
  const runKBounded = async () => {
    setKLoading(true); setKError(''); setKResult(null)
    try {
      const res = await fetch(`${apiBase}/analyze/kbounded`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          net,
          marking: serverMarking || marking || {},
          k: Number.isFinite(+kInput) ? +kInput : null,
          max_depth: 50,
          max_states: 10000
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'k-bounded analysis failed')
      setKResult(data)
    } catch (e) {
      setKError(e.message || String(e))
    } finally {
      setKLoading(false)
    }
  }

  // Per-place verdicts derived from API
  const placeVerdicts = useMemo(() => {
    if (!kResult) return []
    const k = Number(kInput)
    const hit = !!kResult.hit_limits
    const entries = Object.entries(kResult.place_max || {}) // [pid, maxSeen]
    return entries.map(([pid, maxSeen]) => {
      let verdict, hint = ''
      if (!Number.isFinite(k)) {
        verdict = '—'
        hint = `max seen = ${maxSeen}`
      } else if (!hit) {
        verdict = (maxSeen <= k) ? 'Yes' : 'No'
        hint = `max seen = ${maxSeen}`
      } else {
        // Unknown if we didn't exceed k; definite No if we already exceeded
        verdict = (maxSeen > k) ? 'No' : 'Unknown'
        hint = `min bound≥${maxSeen}`
      }
      return { pid, verdict, hint }
    })
  }, [kResult, kInput])

  const netVerdicts = useMemo(() => {
    if (!kResult) return { kBounded: '—', safe: '—' }
    const kBounded = kResult.is_k_bounded === true
      ? 'Yes'
      : kResult.is_k_bounded === false
        ? 'No'
        : 'Unknown'
    const safe = kResult.is_safe === true
      ? 'Yes'
      : kResult.is_safe === false
        ? 'No'
        : 'Unknown'
    return { kBounded, safe }
  }, [kResult])

  const totalTokens = useMemo(
    () => Object.values(serverMarking || {}).reduce((s, v) => s + (v || 0), 0),
    [serverMarking]
  )

  const placesSorted = useMemo(() => {
    const map = new Map(net.places.map(p => [p.id, p]))
    return Object.entries(serverMarking || {})
      .map(([pid, v]) => ({ id: pid, label: (map.get(pid)?.label ?? pid), tokens: v ?? 0 }))
      .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id))
  }, [net.places, serverMarking])

  const Badge = ({ kind, children }) => {
    const colors = {
      Yes:     { bg:'#e6f7ea', fg:'#137a2a', br:'#bfe6c8' },
      No:      { bg:'#fdeaea', fg:'#9b2424', br:'#f7c1c1' },
      Unknown: { bg:'#f5f7fb', fg:'#434a60', br:'#e1e6f0' },
      '—':     { bg:'#f5f7fb', fg:'#434a60', br:'#e1e6f0' },
    }[kind] || { bg:'#f5f7fb', fg:'#434a60', br:'#e1e6f0' }
    return (
      <span style={{
        display:'inline-block', padding:'2px 8px', borderRadius:999,
        fontSize:12, fontWeight:700, background:colors.bg, color:colors.fg, border:`1px solid ${colors.br}`
      }}>
        {children}
      </span>
    )
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <div style={panelStyle}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <h2 id="analysis-title" style={{ margin:0 }}>Analysis</h2>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close analysis">✕</button>
        </div>

        <div style={{ marginTop: 8 }}>
          {loading ? <div>Analyzing…</div> : null}
          {error ? <div style={{ color:'crimson' }}>{error}</div> : null}

          {/* ---- keep: Deadlock & Enabled summary ---- */}
          <div style={gridStyle}>
            <div>
              <div style={labelStyle}>Deadlock</div>
              <div style={{ fontWeight: 700, color: deadlocked ? 'crimson' : 'green' }}>
                {deadlocked ? 'Yes (no transitions enabled)' : 'No'}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Enabled transitions</div>
              <div style={{ fontFamily: 'monospace' }}>
                {enabled.length ? enabled.join(', ') : '—'}
              </div>
            </div>

            <div>
              <div style={labelStyle}>Total tokens</div>
              <div style={{ fontVariantNumeric: 'tabular-nums' }}>{totalTokens}</div>
            </div>
          </div>

          {/* ---- keep: Current marking table ---- */}
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: '12px 0 6px' }}>Marking</h3>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Place</th>
                    <th style={thStyle}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {placesSorted.map((p) => (
                    <tr key={p.id}>
                      <td style={tdStyle}>
                        <code title={p.id}>{p.label || p.id}</code>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {p.tokens}
                      </td>
                    </tr>
                  ))}
                  {placesSorted.length === 0 && (
                    <tr><td style={tdStyle} colSpan={2}>(no places)</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- simplified: k-beschränkt / Safe ---- */}
          <div style={{ marginTop: 18 }}>
            <h3 style={{ margin: '12px 0 6px' }}>k-beschränkt / Safe</h3>

            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <label>k</label>
              <input
                type="number"
                min="0"
                value={kInput}
                onChange={e => setKInput(e.target.value)}
                style={{ width:100 }}
              />
              <button onClick={runKBounded} disabled={kLoading}>
                {kLoading ? 'Checking…' : 'Check'}
              </button>
              {kError && <span style={{ color:'crimson' }}>{kError}</span>}
            </div>

            {kResult && (
              <div style={{ marginTop: 12 }}>
                {/* Net-level verdicts */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div>
                    <div style={labelSmall}>Net ist k-beschränkt (k={kInput})</div>
                    <Badge kind={
                      kResult.is_k_bounded === true ? 'Yes' :
                      kResult.is_k_bounded === false ? 'No' : 'Unknown'
                    }>
                      {kResult.is_k_bounded === true ? 'Yes' :
                       kResult.is_k_bounded === false ? 'No' : 'Unknown'}
                    </Badge>
                  </div>
                  <div>
                    <div style={labelSmall}>Net ist sicher (1-beschränkt)</div>
                    <Badge kind={
                      kResult.is_safe === true ? 'Yes' :
                      kResult.is_safe === false ? 'No' : 'Unknown'
                    }>
                      {kResult.is_safe === true ? 'Yes' :
                       kResult.is_safe === false ? 'No' : 'Unknown'}
                    </Badge>
                  </div>
                </div>

                {/* Per-place verdicts */}
                <div style={{ marginTop: 14 }}>
                  <div style={labelSmall}>Stellen (k-beschränkt?)</div>
                  <div style={{ border:'1px solid #e8e8e8', borderRadius:8, overflow:'hidden' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Place</th>
                          <th style={thStyle}>Verdict</th>
                          <th style={thStyle}>Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {placeVerdicts.map(({ pid, verdict, hint }) => (
                          <tr key={pid}>
                            <td style={tdStyle}><code>{pid}</code></td>
                            <td style={tdStyle}><Badge kind={verdict}>{verdict}</Badge></td>
                            <td style={{ ...tdStyle, color:'#556', fontSize:12 }}>{hint}</td>
                          </tr>
                        ))}
                        {placeVerdicts.length === 0 && (
                          <tr><td style={tdStyle} colSpan={3}>(no places)</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop:8, fontSize:12, opacity:0.75 }}>
                    {kResult.hit_limits
                      ? <>Hinweis: Suche wurde begrenzt. Ergebnisse können <em>Unknown</em> sein, wenn bisher kein Gegenbeispiel gefunden wurde.</>
                      : <>Voller Zustandsraum wurde erkundet. Aussagen sind exakt.</>}
                  </div>

                  <div style={{ marginTop:8, fontSize:12, opacity:0.8 }}>
                    minimal beobachtetes k = <code>{kResult.minimal_k_observed}</code> ·
                    untersuchte Zustände = <code>{kResult.explored_states}</code> ·
                    Tiefe = <code>{kResult.depth_reached}</code>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>
            Uses <code>/analyze/state</code> for deadlocks & enabled, and <code>/analyze/kbounded</code> for k-bounded/safe.
          </p>
        </div>
      </div>
    </div>
  )
}

/* --- Inline styles --- */
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
}
const panelStyle = {
  background: 'white', color: 'inherit', width: 560, maxWidth: '92vw',
  borderRadius: 12, padding: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.25)'
}
const closeBtnStyle = {
  border: '1px solid #ddd', background: '#fafafa', borderRadius: 8, padding: '6px 10px', cursor: 'pointer'
}
const gridStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 8
}
const labelStyle = { fontSize: 12, opacity: 0.75, marginBottom: 2 }
const labelSmall = { fontSize: 12, opacity: 0.8, marginBottom: 4 }
const thStyle = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #eee', background: '#fafafa' }
const tdStyle = { padding: '8px 10px', borderBottom: '1px solid #f2f2f2' }
