import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  ReactFlow, MiniMap, Controls, Background, addEdge,
  useNodesState, useEdgesState, Handle, Position, MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './global.css'
import dagre from 'dagre'
import AnalysisPanel from './components/AnalysisPanel'   

const API =
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:8000' // local dev
    : 'https://des2-petrinetsimulator.hf.space'); // actual Space URL


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
  const [toast, setToast] = useState('')               // small success/fail popups
  const [showAnalysis, setShowAnalysis] = useState(false) // ← NEW

  // default edge options: always show arrowheads
  const defaultEdgeOptions = { markerEnd: { type: MarkerType.ArrowClosed } }

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
      { ...params, label:'1', data:{ weight:1 }, markerEnd:{ type: MarkerType.ArrowClosed } },
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

  // Helpers to pass to AnalysisPanel
  const getNet = () => toNet()
  const getMarking = () =>
    Object.fromEntries(nodes.filter(isP).map(p => [p.id, p.data?.tokens ?? 0]))

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
      markerEnd:{ type: MarkerType.ArrowClosed }
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

  /* === enabled set from an arbitrary stored marking (for history coloring) === */
  const enabledAtTokens = useCallback((tokens) => {
    const nodeById = Object.fromEntries(nodes.map(n => [n.id, n.type]))
    const inArcs = {}
    edges.forEach(e => {
      if (nodeById[e.target] === 'transition') {
        ;(inArcs[e.target] ||= []).push(e)
      }
    })
    return nodes
      .filter(n => n.type === 'transition')
      .filter(tr => (inArcs[tr.id] || []).every(a =>
        (tokens[a.source] ?? 0) >= (a.data?.weight ?? 1)
      ))
      .map(tr => tr.id)
  }, [nodes, edges])

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
      return [...head, newStep] // truncate tail -> branch from current
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

  // --- Fire (records; CONTINUES FROM CURRENT STEP WITHOUT JUMPING TO LAST) ---
  const fire = async (tid) => {
    if (isFiring) return
    setIsFiring(true)
    setError('')
    try {
      // Initialize history if first time
      ensureHistoryInit()

      const res = await fetch(`${API}/simulate/fire`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ net: toNet(), transition_id: tid })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Request failed')

      const tokens = Object.fromEntries(data.net.places.map(p => [p.id, p.tokens ?? 0]))

      // Apply tokens and recompute enabled; record step branching from current
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

  /* ---------- Auto-run loop (continues from current step; branches naturally) ---------- */
  useEffect(() => {
    if (!autoRun || mode !== 'simulation') return
    let cancelled = false
    let timer

    const step = async () => {
      if (cancelled) return
      // Initialize recording if needed
      ensureHistoryInit()

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
    nodes.forEach(n => g.setNode(n.id, { width: isP(n)?64:16, height: isP(n)?64:64 }))
    edges.forEach(e => g.setEdge(e.source, e.target))
    dagre.layout(g)
    setNodes(ns => ns.map(n => {
      const pos = g.node(n.id); if (!pos) return n
      const dx = isP(n) ? 32 : 8, dy = isP(n) ? 32 : 32
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
      const url = URL.createObjectURL(blob)
      a.href = url
      a.download = `petri-net-${ts}.pnml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
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

const buildTikZ = (opts = {}) => {
  const {
    fullDocument = true,
    scale = 40,
    includeLabels = true,
    curvySingles = true,
  } = opts

  const escTex = (s='') => String(s).replace(/([%$&#_^{}])/g, '\\$1')
  const net = toNet()

  const allNodes = [...net.places, ...net.transitions]
  let minX = 0, minY = 0
  if (allNodes.length) {
    minX = Math.min(...allNodes.map(n => Number.isFinite(n.x) ? n.x : 0))
    minY = Math.min(...allNodes.map(n => Number.isFinite(n.y) ? n.y : 0))
  }
  const toCm = (px) => Math.round(((px) / scale) * 100) / 100
  const getCoord = (n) => {
    const x = toCm((n.x ?? 0) - minX)
    const y = toCm(-((n.y ?? 0) - minY))
    return { x, y }
  }

  const idToPos = new Map()
  net.places.forEach(p => idToPos.set(p.id, getCoord(p)))
  net.transitions.forEach(t => idToPos.set(t.id, getCoord(t)))

  // Dot positions (in cm) relative to node center (<=6 => dots; else count)
  const tokenOffsets = (k) => {
    switch (Math.max(0, k|0)) {
      case 0:  return []
      case 1:  return [[0,0]]
      case 2:  return [[-0.22,0],[0.22,0]]
      case 3:  return [[-0.24,-0.14],[0.24,-0.14],[0,0.22]]
      case 4:  return [[-0.24,-0.24],[0.24,-0.24],[-0.24,0.24],[0.24,0.24]]
      case 5:  return [[-0.24,-0.24],[0.24,-0.24],[0,0],[-0.24,0.24],[0.24,0.24]]
      default: return [[-0.30,-0.18],[0,-0.18],[0.30,-0.18],[-0.30,0.18],[0,0.18],[0.30,0.18]]
    }
  }

  const placeLines = net.places.map(p => {
    const label = (p.label ?? '').trim()
    const labelPart = (includeLabels && label) ? `, label=above:{${escTex(label)}}` : ''
    const {x,y} = idToPos.get(p.id) || {x:0,y:0}
    return `\\node[place${labelPart}] (${escTex(p.id)}) at (${x},${y}) {};`
  }).join('\n')

  const transLines = net.transitions.map(t => {
    const label = (t.label ?? '').trim()
    const labelPart = (includeLabels && label) ? `, label=above:{${escTex(label)}}` : ''
    const {x,y} = idToPos.get(t.id) || {x:0,y:0}
    return `\\node[transition${labelPart}] (${escTex(t.id)}) at (${x},${y}) {};`
  }).join('\n')

  // Tokens WITHOUT calc lib (use xshift/yshift)
  const tokenLines = net.places.map(p => {
    const k = Math.max(0, p.tokens|0)
    if (k === 0) return ''
    const id = escTex(p.id)
    const offs = tokenOffsets(k)
    if (k <= 6) {
      return offs.map(([dx,dy]) =>
        `\\node[tokenDot] at ([xshift=${dx}cm,yshift=${dy}cm] ${id}) {};`
      ).join('\n')
    }
    return `\\node[tokenCount] at (${id}) {${k}};`
  }).filter(Boolean).join('\n')

  // Arc geometry: curved, parallel fan-out, self-loops
  const keyUndir = (a) => [a.src, a.dst].sort().join('|')
  const hasOppMap = new Map()
  const dirCounts = new Map()
  net.arcs.forEach(a => {
    const und = keyUndir(a)
    hasOppMap.set(und, (hasOppMap.get(und) || new Set()).add(a.src < a.dst ? 'fwd' : 'rev'))
    const dirKey = `${a.src}->${a.dst}`
    dirCounts.set(dirKey, (dirCounts.get(dirKey) || 0) + 1)
  })
  const hasOpposite = (a) => {
    const s = hasOppMap.get(keyUndir(a))
    return s && s.size === 2
  }
  const dirIndex = new Map()
  const sideSign = (a) => (a.src < a.dst ? +1 : -1)
  const curveMag = (idx) => 10 + idx * 8

  const arcAngles = (a) => {
    const sp = idToPos.get(a.src) || {x:0,y:0}
    const tp = idToPos.get(a.dst) || {x:0,y:0}
    const theta = Math.atan2((tp.y - sp.y), (tp.x - sp.x)) * 180 / Math.PI
    const dirKey = `${a.src}->${a.dst}`
    const idx = dirIndex.get(dirKey) || 0
    dirIndex.set(dirKey, idx + 1)
    const count = dirCounts.get(dirKey) || 1
    let sign = 0, mag = 0
    if (hasOpposite(a)) { sign = sideSign(a); mag = curveMag(idx) }
    else if (count > 1) { sign = +1; mag = curveMag(idx) }
    else { if (curvySingles) { sign = +1; mag = 12 } }
    const phi = sign * mag
    return { out: theta + phi, inn: theta + 180 - phi }
  }

  const selfLoopAngles = (idx) => {
    const presets = [
      { out: 60,  inn: 120, loose: 10 },
      { out:-60,  inn:-120, loose: 10 },
      { out: 30,  inn: 150, loose: 12 },
      { out:-30,  inn:-150, loose: 12 },
    ]
    return presets[idx % presets.length]
  }
  const selfCounts = new Map()

  const arcLines = net.arcs.map(a => {
    if (a.src === a.dst) {
      const idx = selfCounts.get(a.src) || 0
      selfCounts.set(a.src, idx + 1)
      const { out, inn, loose } = selfLoopAngles(idx)
      const w = a.weight ?? 1
      const wLabel = w !== 1 ? ` node[pos=0.5, above]{${w}}` : ''
      return `\\draw[arc, looseness=${loose}, out=${out}, in=${inn}] (${escTex(a.src)}) to${wLabel} (${escTex(a.dst)});`
    } else {
      const { out, inn } = arcAngles(a)
      const w = a.weight ?? 1
      const wLabel = w !== 1 ? ` node[midway, sloped, above]{${w}}` : ''
      return `\\draw[arc, out=${out.toFixed(1)}, in=${inn.toFixed(1)}] (${escTex(a.src)}) to${wLabel} (${escTex(a.dst)});`
    }
  }).join('\n')

  const tikzBody = `% Generated by PetriNetPro — curved arcs, self-loops, dot tokens (no calc lib)
% 1cm ≈ ${scale} px from the canvas
\\begin{tikzpicture}[
  >=Stealth,
  bend angle=20,
  place/.style={circle, draw, thick, minimum size=12mm, inner sep=0, align=center},
  transition/.style={rectangle, draw, thick, minimum width=4mm, minimum height=12mm, inner sep=0},
  arc/.style={->, semithick, shorten >=3pt, shorten <=3pt},
  tokenDot/.style={circle, fill=black, inner sep=1.4pt},
  tokenCount/.style={font=\\footnotesize}
]
  % Nodes
${placeLines ? '  ' + placeLines.replace(/\n/g, '\n  ') : ''}
${transLines ? '\n  ' + transLines.replace(/\n/g, '\n  ') : ''}

  % Tokens
${tokenLines ? '  ' + tokenLines.replace(/\n/g, '\n  ') : ''}

  % Arcs
${arcLines ? '  ' + arcLines.replace(/\n/g, '\n  ') : ''}
\\end{tikzpicture}
`

  if (!fullDocument) return tikzBody

  return `\\documentclass[tikz,border=10pt]{standalone}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning}
${tikzBody}`
}

  // Download as .tex
  const exportTikZ = (opts = {}) => {
    const doc = buildTikZ(opts)
    const blob = new Blob([doc], { type: 'application/x-tex' })
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = `petri-net-${ts}.tex`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Copy to clipboard (uses HTTPS Clipboard API; falls back to execCommand)
  const copyTikZ = async (opts = {}) => {
    const text = buildTikZ({ fullDocument: false, ...opts })
    try {
      await navigator.clipboard.writeText(text)
      setToast('TikZ copied to clipboard ✓')
      setTimeout(() => setToast(''), 1400)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'; ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        document.execCommand('copy')
        ta.remove()
        setToast('TikZ copied to clipboard ✓')
        setTimeout(() => setToast(''), 1400)
      } catch (e2) {
        setError('Copy failed: ' + (e2?.message || 'unknown error'))
      }
    }
  }

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
      markerEnd: { type: MarkerType.ArrowClosed }
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

        {/* 8) Import / Export PNML + Export/Copy LaTeX */}
        <div className="group">
          <button className="button" onClick={() => pnmlRef.current?.click()}>Import PNML</button>
          <button className="button" onClick={exportPNML}>Export PNML</button>
          <button className="button" onClick={() => exportTikZ({ fullDocument: true })}>Export LaTeX (TikZ)</button>
          <button className="button" onClick={() => copyTikZ({})}>Copy LaTeX (TikZ)</button>
          <input
            ref={pnmlRef}
            type="file"
            accept=".pnml,application/xml,text/xml"
            style={{ display:'none' }}
            onChange={handleImportPNML}
          />
        </div>

        {/* 9) Analyze (opens panel) */}
        <div className="group">
          <button className="button" onClick={() => setShowAnalysis(true)}>Analyze</button>
        </div>

        {error && <span className="error" role="alert" style={{ marginLeft: 12 }}>⚠ {error}</span>}
        {toast && <span className="toast" role="status">{toast}</span>}
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
            defaultEdgeOptions={defaultEdgeOptions}
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
            Click steps in History to rewind/branch—new steps will continue from the selected point.
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

              {/* Legend */}
              <div className="label" style={{ marginTop:6, opacity:0.8 }}>
                Steps highlighted indicate multiple next transitions were enabled (an alternative could have fired).
              </div>

              <div style={{ maxHeight: 180, overflow:'auto', marginTop:8, border:'1px solid var(--line,#ddd)', borderRadius:8, padding:8 }}>
                {history.map((st, i) => {
                  const enabledHere = enabledAtTokens(st.tokens)
                  const hasAlternatives = enabledHere.length > 1
                  return (
                    <div
                      key={i}
                      onClick={() => goTo(i)}
                      style={{
                        display:'flex',
                        justifyContent:'space-between',
                        alignItems:'center',
                        padding:'6px 8px',
                        cursor:'pointer',
                        borderRadius:6,
                        background: i===hIndex
                          ? 'rgba(0,0,0,0.06)'
                          : (hasAlternatives ? 'rgba(255, 215, 0, 0.18)' : 'transparent'),
                        border: hasAlternatives ? '1px solid rgba(255, 191, 0, 0.6)' : '1px solid transparent'
                      }}
                      title={st.fired ? `Fired ${st.fired}` : 'Initial'}
                    >
                      <div style={{ fontFamily:'monospace' }}>
                        {i===0 ? 'Init' : `Fire ${st.fired}`}
                        {hasAlternatives && <span style={{ marginLeft:8, fontSize:12, opacity:0.8 }}>(choices: {enabledHere.join(', ')})</span>}
                      </div>
                      <div style={{ fontSize:12, opacity:0.7 }}>
                        {new Date(st.ts).toLocaleTimeString()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Analysis Panel (modal) ===== */}
      {showAnalysis && (
        <AnalysisPanel
          apiBase={API}
          net={getNet()}
          marking={getMarking()}
          enabledLocal={computeEnabled(nodes, edges)}
          onClose={() => setShowAnalysis(false)}
        />
      )}
    </div>
  )
}
