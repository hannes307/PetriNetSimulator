import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  ReactFlow, MiniMap, Controls, Background, addEdge,
  useNodesState, useEdgesState, Handle, Position
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './global.css'
import dagre from 'dagre'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/* ====== Visualization ====== */
const DOT_LIMIT = 6
const LABEL_LIMIT = 10  // labels longer than this are hidden

/* ----- custom nodes ----- */
function PlaceNode({ data }) {
  const tokens = Math.max(0, data.tokens ?? 0)
  const showDots = tokens > 0 && tokens <= DOT_LIMIT
  const name = (data.label ?? '').trim()
  const showName = !!data.showLabel && name.length > 0 && name.length <= LABEL_LIMIT

  return (
    <div className="place" aria-label={`Place${name ? ' ' + name : ''} with ${tokens} token${tokens===1?'':'s'}`}>
      {/* TARGET handles */}
      <Handle id="t-left"   type="target" position={Position.Left} />
      <Handle id="t-top"    type="target" position={Position.Top} />
      <Handle id="t-right"  type="target" position={Position.Right} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} />

      {/* SOURCE handles */}
      <Handle id="s-left"   type="source" position={Position.Left} />
      <Handle id="s-top"    type="source" position={Position.Top} />
      <Handle id="s-right"  type="source" position={Position.Right} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} />

      <div style={{ textAlign:'center', lineHeight:1.25 }}>
        {showName && <div style={{ fontSize:12, fontWeight:700 }}>{name}</div>}
        <div className="tokenVis" style={{ marginTop: showName ? 4 : 0 }}>
          {tokens === 0 && <span className="empty">empty</span>}

          {showDots && (
            <div className="dots" style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:'2px' }}>
              {Array.from({ length: tokens }).map((_, i) => (
                <span key={i} className="dot" style={{ fontSize:18, lineHeight:1 }}>•</span>
              ))}
            </div>
          )}

          {!showDots && tokens > DOT_LIMIT && (
            <span className="count" style={{
              display:'inline-block', minWidth:24, padding:'2px 6px',
              fontWeight:700, fontVariantNumeric:'tabular-nums'
            }}>
              {tokens}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
function TransitionNode({ data }) {
  const cls = data.isEnabled ? 'transition enabled' : 'transition'
  const name = (data.label ?? '').trim()
  const showName = !!data.showLabel && name.length > 0 && name.length <= LABEL_LIMIT

  return (
    <div
      className={cls}
      style={{ position:'relative' }}
      onClick={(e)=>data.onClick?.(e)}
      role="button"
      aria-pressed={!!data.isEnabled}
      title={data.isEnabled ? 'Enabled' : 'Not enabled'}
    >
      {/* TARGET handles */}
      <Handle id="t-left"   type="target" position={Position.Left} />
      <Handle id="t-top"    type="target" position={Position.Top} />
      <Handle id="t-right"  type="target" position={Position.Right} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} />

      {/* SOURCE handles */}
      <Handle id="s-left"   type="source" position={Position.Left} />
      <Handle id="s-top"    type="source" position={Position.Top} />
      <Handle id="s-right"  type="source" position={Position.Right} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} />

      {showName && (
        <div style={{ position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)', fontSize:12, fontWeight:700, pointerEvents:'none' }}>
          {name}
        </div>
      )}
    </div>
  )
}
const nodeTypes = { place: PlaceNode, transition: TransitionNode }

let placeCounter = 1, transCounter = 1

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [enabled, setEnabled] = useState([])
  const [isFiring, setIsFiring] = useState(false)
  const [autoRun, setAutoRun] = useState(false)
  const [speed, setSpeed] = useState(400)
  const [mode, setMode] = useState('modelling')     // 'modelling' | 'simulation'
  const [dir, setDir] = useState('LR')
  const [error, setError] = useState('')
  const [connectFrom, setConnectFrom] = useState(null) // Shift+click source
  const [showLabels, setShowLabels] = useState(true)   // toggle label visibility

  // --- History recorder ---
  // step: { fired: string|null, tokens: Record<placeId,number>, ts:number }
  const [history, setHistory] = useState([])
  const [hIndex, setHIndex] = useState(-1) // -1 = no history, otherwise 0..history.length-1
  const hIndexRef = useRef(-1)
  useEffect(() => { hIndexRef.current = hIndex }, [hIndex])

  const isT = n => n?.type === 'transition'
  const isP = n => n?.type === 'place'

  /* ---------- cancel click-to-connect with Escape ---------- */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setConnectFrom(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- stop autoRun if not in simulation ---------- */
  useEffect(() => {
    if (mode !== 'simulation' && autoRun) setAutoRun(false)
  }, [mode, autoRun])

  /* ---------- connect rules P<->T (also clears history) ---------- */
  const clearHistory = useCallback(() => {
    setHistory([]); setHIndex(-1)
  }, [])

  const onConnect = useCallback((params) => {
    const s = nodes.find(n => n.id === params.source)
    const t = nodes.find(n => n.id === params.target)
    const ok = (isP(s) && isT(t)) || (isT(s) && isP(t))
    if (!ok) return
    setEdges(eds => addEdge(
      { ...params, label:'1', data:{ weight:1 }, markerEnd:{ type:'arrowclosed' } },
      eds
    ))
    clearHistory()
  }, [nodes, setEdges, clearHistory])

  /* ---------- add nodes (also clears history) ---------- */
  const addPlace = () => {
    const id = `P${placeCounter++}`
    setNodes(ns => ns.concat({
      id, type:'place', position:{ x:120 + ns.length*24, y:140 },
      data:{ label:'', tokens:0 }
    }))
    clearHistory()
  }
  const addTransition = () => {
    const id = `T${transCounter++}`
    setNodes(ns => ns.concat({
      id, type:'transition', position:{ x:360 + ns.length*24, y:140 },
      data:{ label:'' }
    }))
    clearHistory()
  }

  /* ---------- selection ---------- */
  const onSelectionChange = useCallback(({ nodes: ns = [], edges: es = [] }) => {
    setSelectedId(ns[0]?.id || es[0]?.id || null)
    setSelectedIds([...ns.map(n => n.id), ...es.map(e => e.id)])
  }, [])
  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedId),
    [nodes, selectedId]
  )
  const selectedEdge = useMemo(
    () => edges.find(e => e.id === selectedId),
    [edges, selectedId]
  )

  const updateSelected = (patch) => {
    if (selectedEdge) {
      setEdges(eds => eds.map(e => e.id === selectedEdge.id ? { ...e, ...patch } : e))
      return
    }
    if (selectedNode) {
      setNodes(ns => ns.map(n => n.id === selectedNode.id ? { ...n, ...patch } : n))
    }
  }

  const deleteById = (id)=>{
    setNodes((nds)=>nds.filter(n=>n.id!==id))
    setEdges((eds)=>eds.filter(e=>e.id!==id && e.source!==id && e.target!==id))
    setSelectedId(null); setSelectedIds([])
    clearHistory()
  }

  /* ---------- Delete via keyboard (Delete/Backspace) ---------- */
  useEffect(() => {
    const onKeyDown = (e) => {
      const t = e.target
      const inForm = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (inForm) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length) {
          e.preventDefault()
          const sel = new Set(selectedIds)
          setNodes(nds => nds.filter(n => !sel.has(n.id)))
          setEdges(eds => eds.filter(e =>
            !sel.has(e.id) && !sel.has(e.source) && !sel.has(e.target)
          ))
          setSelectedId(null); setSelectedIds([])
          clearHistory()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedIds, clearHistory])

  /* ---------- Net <-> UI mapping ---------- */
  const toNet = () => {
    const places = nodes.filter(isP).map(n => ({ id:n.id, label:n.data.label ?? '', tokens:n.data.tokens ?? 0, x:n.position.x, y:n.position.y }))
    const transitions = nodes.filter(isT).map(n => ({ id:n.id, label:n.data.label ?? '', x:n.position.x, y:n.position.y }))
    const arcs = edges.map((e,i) => ({ id:e.id || `A${i+1}`, src:e.source, dst:e.target, weight:e.data?.weight ?? 1 }))
    return { places, transitions, arcs }
  }

  const normalizeCounter = (items, prefix, current) => {
    const maxNum = items.reduce((m, it) => {
      const mrx = new RegExp('^' + prefix + '(\\d+)$').exec(it.id || '')
      return Math.max(m, mrx ? parseInt(mrx[1], 10) : 0)
    }, 0)
    return Math.max(current, maxNum + 1)
  }

  const fromNet = (net) => {
    const defPos = (i, baseX) => ({ x: (baseX||100) + i*40, y: 140 })
    const ns = [
      ...net.places.map((p,i) => ({
        id:p.id, type:'place',
        position:{ x:p.x ?? defPos(i,100).x, y:p.y ?? defPos(i,100).y },
        data:{ label:p.label ?? '', tokens:p.tokens ?? 0 }
      })),
      ...net.transitions.map((t,i) => ({
        id:t.id, type:'transition',
        position:{ x:t.x ?? defPos(i,320).x, y:t.y ?? defPos(i,320).y },
        data:{ label:t.label ?? '' }
      })),
    ]
    const es = net.arcs.map(a => ({
      id:a.id, source:a.src, target:a.dst,
      label:String(a.weight ?? 1),
      data:{ weight:a.weight ?? 1 },
      markerEnd:{ type:'arrowclosed' }
    }))

    setNodes(ns); setEdges(es); setSelectedId(null); setSelectedIds([])
    placeCounter = normalizeCounter(net.places || [], 'P', placeCounter)
    transCounter = normalizeCounter(net.transitions || [], 'T', transCounter)
    clearHistory()
  }

  /* ---------- Local enabled computation ---------- */
  const computeEnabled = useCallback((ns, es) => {
    const placeTokens = Object.fromEntries(
      ns.filter(n => n.type === 'place').map(p => [p.id, p.data?.tokens ?? 0])
    )
    const nodeById = Object.fromEntries(ns.map(n => [n.id, n.type]))
    const inArcs = {}
    es.forEach(e => {
      if (nodeById[e.target] === 'transition') {
        ;(inArcs[e.target] ||= []).push(e)
      }
    })
    return ns
      .filter(n => n.type === 'transition')
      .filter(tr => (inArcs[tr.id] || []).every(a =>
        (placeTokens[a.source] ?? 0) >= (a.data?.weight ?? 1)
      ))
      .map(tr => tr.id)
  }, [])

  /* ---------- Simulation ---------- */
  const showEnabled = async () => {
    setEnabled(computeEnabled(nodes, edges)) // instant local
    setError('')
    try {
      const res = await fetch(`${API}/simulate/enabled`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ net: toNet() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Request failed')
      setEnabled(data.enabled || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  // --- History helpers ---
  const collectTokensFromNodes = (ns) =>
    Object.fromEntries(ns.filter(isP).map(p => [p.id, p.data?.tokens ?? 0]))

  const ensureHistoryInit = useCallback(() => {
    if (history.length > 0) return
    const step0 = { fired: null, tokens: collectTokensFromNodes(nodes), ts: Date.now() }
    setHistory([step0])
    setHIndex(0)
  }, [history.length, nodes])

  const appendHistory = useCallback((newStep) => {
    setHistory(prev => {
      const idx = hIndexRef.current
      const head = idx >= 0 ? prev.slice(0, idx + 1) : []
      return [...head, newStep]
    })
    setHIndex(idx => idx + 1)
  }, [])

  const applyStep = useCallback((step) => {
    setNodes(ns => {
      const updated = ns.map(n =>
        isP(n) ? { ...n, data:{ ...n.data, tokens: step.tokens[n.id] ?? 0 } } : n
      )
      setEnabled(computeEnabled(updated, edges))
      return updated
    })
  }, [computeEnabled, edges, setNodes])

  const goTo = (idx) => {
    if (idx < 0 || idx >= history.length) return
    setAutoRun(false)
    setHIndex(idx)
    applyStep(history[idx])
  }

  const stepPrev = () => goTo(hIndex - 1)
  const stepNext = () => goTo(hIndex + 1)
  const stepFirst = () => goTo(0)
  const stepLast = () => goTo(history.length - 1)

  // --- Fire (records when history has been initialized) ---
  const fire = async (tid) => {
    if (isFiring) return
    setIsFiring(true)
    setError('')
    try {
      // Initialize history if "Run"/"Step" is used for the first time
      ensureHistoryInit()

      // If user rewound, jump to latest before producing new steps
      if (hIndexRef.current < history.length - 1) {
        stepLast()
      }

      const res = await fetch(`${API}/simulate/fire`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ net: toNet(), transition_id: tid })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Request failed')

      const tokens = Object.fromEntries(data.net.places.map(p => [p.id, p.tokens ?? 0]))

      // Apply tokens and recompute enabled; record step
      setNodes(ns => {
        const updated = ns.map(n =>
          isP(n) ? { ...n, data:{ ...n.data, tokens: tokens[n.id] ?? 0 } } : n
        )
        const en = computeEnabled(updated, edges)
        setEnabled(en)
        appendHistory({ fired: tid, tokens, ts: Date.now() })
        return updated
      })
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setIsFiring(false)
    }
  }

  /* ---------- Auto-run loop (records automatically) ---------- */
  useEffect(() => {
    if (!autoRun || mode !== 'simulation') return
    let cancelled = false
    let timer

    const step = async () => {
      if (cancelled) return
      // Initialize recording if needed
      ensureHistoryInit()

      // If rewound, jump to last before continuing to run
      if (hIndexRef.current < history.length - 1) {
        stepLast()
      }

      const localEnabled = computeEnabled(nodes, edges)
      if (localEnabled.length === 0) {
        setAutoRun(false)
        setEnabled(localEnabled)
        return
      }
      await fire(localEnabled[0])
      if (!cancelled) timer = setTimeout(step, speed)
    }

    timer = setTimeout(step, speed)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [autoRun, mode, speed, nodes, edges, computeEnabled, fire, ensureHistoryInit, history.length])

  /* ---------- Layout ---------- */
  const layout = () => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: dir })
    g.setDefaultEdgeLabel(() => ({}))
    nodes.forEach(n => g.setNode(n.id, { width: isP(n)?64:16, height: isP(n)?64:76 }))
    edges.forEach(e => g.setEdge(e.source, e.target))
    dagre.layout(g)
    setNodes(ns => ns.map(n => {
      const pos = g.node(n.id); if (!pos) return n
      const dx = isP(n) ? 32 : 8, dy = isP(n) ? 32 : 38
      return { ...n, position: { x: pos.x - dx, y: pos.y - dy } }
    }))
  }

  /* ---------- Demo seed ---------- */
  const seed = () => {
    fromNet({
      places: [{ id:'P1', label:'P1', tokens:1 }, { id:'P2', label:'P2', tokens:0 }],
      transitions: [{ id:'T1', label:'T1' }],
      arcs: [{ id:'A1', src:'P1', dst:'T1', weight:1 }, { id:'A2', src:'T1', dst:'P2', weight:1 }]
    })
    setTimeout(showEnabled, 0)
  }

  /* ---------- PNML helpers ---------- */
  const pnmlRef = useRef()
  const esc = (s='') =>
    String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))

  const exportPNML = () => {
    try {
      const net = toNet()
      const placesXml = net.places.map(p => {
        const name = (p.label ?? '').trim()
        return `
        <place id="${esc(p.id)}">
          ${name ? `<name><text>${esc(name)}</text></name>` : ''}
          ${Number.isFinite(p.tokens) ? `<initialMarking><text>${p.tokens}</text></initialMarking>` : ''}
          <graphics><position x="${Math.round(p.x)}" y="${Math.round(p.y)}"/></graphics>
        </place>`.trim()
      }).join('\n')

      const transXml = net.transitions.map(t => {
        const name = (t.label ?? '').trim()
        return `
        <transition id="${esc(t.id)}">
          ${name ? `<name><text>${esc(name)}</text></name>` : ''}
          <graphics><position x="${Math.round(t.x)}" y="${Math.round(t.y)}"/></graphics>
        </transition>`.trim()
      }).join('\n')

      const arcsXml = net.arcs.map((a,i) => `
        <arc id="${esc(a.id || `A${i+1}`)}" source="${esc(a.src)}" target="${esc(a.dst)}">
          ${a.weight && a.weight !== 1 ? `<inscription><text>${a.weight}</text></inscription>` : ''}
        </arc>`.trim()
      ).join('\n')

      const pnml = `<?xml version="1.0" encoding="UTF-8"?>
<pnml>
  <net id="net1" type="http://www.pnml.org/version-2009/grammar/ptnet">
    <name><text>pnpro-export</text></name>
    <page id="page0">
${placesXml ? '      ' + placesXml.replace(/\n/g, '\n      ') : ''}
${transXml ? '\n      ' + transXml.replace(/\n/g, '\n      ') : ''}
${arcsXml ? '\n      ' + arcsXml.replace(/\n/g, '\n      ') : ''}
    </page>
  </net>
</pnml>`

      const blob = new Blob([pnml], { type: 'application/xml' })
      const a = document.createElement('a')
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.href = URL.createObjectURL(blob)
      a.download = `petri-net-${ts}.pnml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError('Export PNML failed: ' + (e?.message || String(e)))
    }
  }

  const parseText = (el, sel) => {
    const n = el.querySelector(sel)
    return n ? n.textContent ?? '' : ''
  }

  const handleImportPNML = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onerror = () => setError('Could not read PNML file')
    reader.onload = () => {
      try {
        const xml = String(reader.result || '')
        const dom = new DOMParser().parseFromString(xml, 'application/xml')
        const errNode = dom.querySelector('parsererror')
        if (errNode) throw new Error('Invalid XML')

        const placeEls = Array.from(dom.querySelectorAll('net place, page place, place'))
        const transEls = Array.from(dom.querySelectorAll('net transition, page transition, transition'))
        const arcEls = Array.from(dom.querySelectorAll('net arc, page arc, arc'))

        const places = placeEls.map((p,i) => {
          const id = p.getAttribute('id') || `P${i+1}`
          const label = parseText(p, 'name > text').trim()
          const tokensTxt = parseText(p, 'initialMarking > text').trim()
          const tokens = Math.max(0, parseInt(tokensTxt || '0', 10) || 0)
          const pos = p.querySelector('graphics > position')
          const x = pos ? parseFloat(pos.getAttribute('x') || '0') : undefined
          const y = pos ? parseFloat(pos.getAttribute('y') || '0') : undefined
          return { id, label, tokens, x, y }
        })

        const transitions = transEls.map((t,i) => {
          const id = t.getAttribute('id') || `T${i+1}`
          const label = parseText(t, 'name > text').trim()
          const pos = t.querySelector('graphics > position')
          const x = pos ? parseFloat(pos.getAttribute('x') || '0') : undefined
          const y = pos ? parseFloat(pos.getAttribute('y') || '0') : undefined
          return { id, label, x, y }
        })

        const arcs = arcEls.map((a,i) => {
          const id = a.getAttribute('id') || `A${i+1}`
          const src = a.getAttribute('source') || ''
          const dst = a.getAttribute('target') || ''
          const wTxt = parseText(a, 'inscription > text').trim()
          const weight = Math.max(1, parseInt(wTxt || '1', 10) || 1)
          return { id, src, dst, weight }
        })

        // Basic reference checks
        const ids = new Set([...places.map(p=>p.id), ...transitions.map(t=>t.id)])
        arcs.forEach((arc) => {
          if (!ids.has(arc.src) || !ids.has(arc.dst)) {
            throw new Error(`Arc ${arc.id} references unknown nodes`)
          }
        })

        setAutoRun(false)
        fromNet({ places, transitions, arcs })
        setTimeout(showEnabled, 0)
        setError('')
      } catch (err) {
        setError('Import PNML failed: ' + (err?.message || String(err)))
      } finally {
        e.target.value = '' // allow re-importing same file
      }
    }
    reader.readAsText(file)
  }

  const onImportPNMLClick = () => pnmlRef.current?.click()

  /* ---------- Shift+click to connect (P<->T) ---------- */
  const handleNodeClick = (nodeId, e) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    // Simulation quick-fire (manual)
    if (!e.shiftKey) {
      if (mode === 'simulation' && node.type === 'transition') {
        if (isFiring) return
        if (!enabled.includes(node.id)) return
        fire(node.id)
      }
      return
    }

    // Modelling: Shift+click connect
    if (mode !== 'modelling') return
    setError('')
    if (!connectFrom) {
      setConnectFrom(nodeId)
      return
    }
    if (connectFrom === nodeId) {
      setConnectFrom(null)
      return
    }
    const s = nodes.find(n => n.id === connectFrom)
    const t = node
    const ok = (isP(s) && isT(t)) || (isT(s) && isP(t))
    if (!ok) {
      setError('Only P↔T connections are allowed')
      setConnectFrom(null)
      return
    }
    setEdges(eds => addEdge({
      id: undefined,
      source: connectFrom,
      target: nodeId,
      label: '1',
      data: { weight: 1 },
      markerEnd: { type: 'arrowclosed' }
    }, eds))
    setConnectFrom(null)
    clearHistory()
  }

  /* ---------- Render with click guard & click-to-connect ---------- */
  const renderedNodes = nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      showLabel: showLabels,
      isEnabled: n.type === 'transition' ? enabled.includes(n.id) : undefined,
      onClick: (e) => handleNodeClick(n.id, e)
    }
  }))

  return (
    <div className="app">
      <div className="topbar">
        {/* 1) Place */}
        <div className="group">
          <button className="button" onClick={addPlace}>Place</button>
        </div>

        {/* 2) Transition */}
        <div className="group">
          <button className="button" onClick={addTransition}>Transition</button>
        </div>

        {/* 3) Mode (with sim controls when Simulation) */}
        <div className="group">
          <label>Mode</label>
          <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="modelling">Modelling</option>
            <option value="simulation">Simulation</option>
          </select>
          {mode === 'simulation' && (
            <>
              <button className="button" onClick={showEnabled}>Check enabled</button>
              <button className="button" onClick={() => { ensureHistoryInit(); setAutoRun(a => !a) }}>
                {autoRun ? 'Pause Run' : 'Run'}
              </button>
              <button className="button" onClick={() => {
                ensureHistoryInit()
                const localEnabled = computeEnabled(nodes, edges)
                if (localEnabled.length > 0) fire(localEnabled[0])
              }}>
                Step
              </button>
              <label className="label" style={{ marginLeft:8 }}>Speed</label>
              <input
                className="input"
                type="range" min="100" max="1500" step="50"
                value={speed} onChange={(e)=>setSpeed(Number(e.target.value))}
                style={{ width:120, verticalAlign:'middle' }}
              />
            </>
          )}
        </div>

        {/* 4) Layout (Dagre) */}
        <div className="group">
          <label>Layout (Dagre)</label>
          <select className="select" value={dir} onChange={e => setDir(e.target.value)}>
            <option value="LR">LR</option>
            <option value="TB">TB</option>
          </select>
          <button className="button" onClick={layout}>Apply</button>
        </div>

        {/* 5) New */}
        <div className="group">
          <button
            className="button"
            onClick={() => {
              setNodes([]); setEdges([]); placeCounter=1; transCounter=1; setEnabled([]); setError('');
              setSelectedId(null); setSelectedIds([]); setConnectFrom(null); setAutoRun(false)
              clearHistory()
            }}
          >
            New
          </button>
        </div>

        {/* 6) Example */}
        <div className="group">
          <button className="button" onClick={seed}>Example</button>
        </div>

        {/* 7) Show names */}
        <div className="group">
          <label style={{ marginRight: 6 }}>Show names</label>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
            title="Toggle node labels"
          />
        </div>

        {/* 8) Import / Export PNML */}
        <div className="group">
          <button className="button" onClick={() => pnmlRef.current?.click()}>Import PNML</button>
          <button className="button" onClick={exportPNML}>Export PNML</button>
          <input
            ref={pnmlRef}
            type="file"
            accept=".pnml,application/xml,text/xml"
            style={{ display:'none' }}
            onChange={handleImportPNML}
          />
        </div>

        {error && <span className="error" role="alert" style={{ marginLeft: 12 }}>⚠ {error}</span>}
      </div>

      <div className="canvas">
        <div className="gridBg" style={{ height:'calc(100% - 56px)' }}>
          <ReactFlow
            nodeOrigin={[0.5, 0.5]}
            nodes={renderedNodes}
            edges={edges.map(e => ({ ...e, label: String(e.data?.weight ?? 1) }))}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            snapToGrid
            snapGrid={[20,20]}
            style={{ width:'100%', height:'100%' }}
          >
            <MiniMap />
            <Controls />
            <Background variant="dots" gap={20} size={1} />
          </ReactFlow>
        </div>
      </div>

      <div className="panel">
        <h3>Inspector</h3>

        {!selectedId && (
          <p className="label">
            Add nodes. Drag from any handle or use <kbd>Shift</kbd>+click (source, then target) to connect.
            In Simulation, use <strong>Run</strong> to record steps automatically, or <strong>Step</strong> for one tick.
            Click steps in History to rewind/forward.
          </p>
        )}

        {selectedNode && (
          <div>
            <div className="label">ID</div><div><code>{selectedNode.id}</code></div>
            <div className="label">Label</div>
            <input
              className="input"
              value={selectedNode.data?.label ?? ''}
              onChange={(e) =>
                updateSelected({ data:{ ...selectedNode.data, label:e.target.value } })
              }
            />
            {selectedNode.type === 'place' && <>
              <div className="label">Tokens</div>
              <input
                className="input"
                type="number"
                min="0"
                value={selectedNode.data?.tokens ?? 0}
                onChange={(e) => {
                  const val = Math.max(0, parseInt(e.target.value || '0', 10))
                  updateSelected({ data:{ ...selectedNode.data, tokens: val } })
                }}
              />
            </>}
          </div>
        )}

        {selectedEdge && (
          <div>
            <div className="label">Edge ID</div><div><code>{selectedEdge.id}</code></div>
            <div className="label">Weight</div>
            <input
              className="input"
              type="number"
              min="1"
              value={selectedEdge.data?.weight ?? 1}
              onChange={(e) => {
                const val = Math.max(1, parseInt(e.target.value || '1', 10))
                updateSelected({ data:{ ...selectedEdge.data, weight: val } })
              }}
            />
          </div>
        )}

        {selectedId && (
          <div style={{ marginTop:12 }}>
            <button className="button danger" onClick={() => deleteById(selectedId)}>Delete</button>
          </div>
        )}

        {/* ===== History ===== */}
        <div style={{ marginTop: 18 }}>
          <h3>History</h3>
          {history.length === 0 ? (
            <p className="label">No history yet. Press <strong>Run</strong> or <strong>Step</strong> in Simulation mode to begin recording.</p>
          ) : (
            <>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <button className="button" onClick={stepFirst} disabled={hIndex <= 0}>⏮ First</button>
                <button className="button" onClick={stepPrev}  disabled={hIndex <= 0}>◀ Prev</button>
                <span className="label">Step {hIndex + 1} / {history.length}</span>
                <button className="button" onClick={stepNext} disabled={hIndex >= history.length - 1}>Next ▶</button>
                <button className="button" onClick={stepLast} disabled={hIndex >= history.length - 1}>Last ⏭</button>
                <button className="button danger" onClick={clearHistory}>Clear</button>
              </div>
              <div style={{ maxHeight: 180, overflow:'auto', marginTop:8, border:'1px solid var(--line,#ddd)', borderRadius:8, padding:8 }}>
                {history.map((st, i) => (
                  <div
                    key={i}
                    onClick={() => goTo(i)}
                    style={{
                      display:'flex', justifyContent:'space-between', alignItems:'center',
                      padding:'6px 8px', cursor:'pointer',
                      background: i===hIndex ? 'rgba(0,0,0,0.06)' : 'transparent',
                      borderRadius:6
                    }}
                    title={st.fired ? `Fired ${st.fired}` : 'Initial'}
                  >
                    <div style={{ fontFamily:'monospace' }}>
                      {i===0 ? 'Init' : `Fire ${st.fired}`}
                    </div>
                    <div style={{ fontSize:12, opacity:0.7 }}>
                      {new Date(st.ts).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
