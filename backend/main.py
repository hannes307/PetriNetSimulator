from typing import List, Dict, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

# --------- Models ----------
class PlaceModel(BaseModel):
    id: str
    label: str
    tokens: int = 0
    @field_validator('tokens')
    def nonneg(cls, v):
        if v < 0: raise ValueError("tokens must be >= 0")
        return v

class TransitionModel(BaseModel):
    id: str
    label: str

class ArcModel(BaseModel):
    id: str
    src: str
    dst: str
    weight: int = 1
    @field_validator('weight')
    def pos(cls, v):
        if v <= 0: raise ValueError("weight must be >= 1")
        return v

class NetModel(BaseModel):
    places: List[PlaceModel]
    transitions: List[TransitionModel]
    arcs: List[ArcModel]

class EnabledRequest(BaseModel):
    net: NetModel
    marking: Optional[Dict[str,int]] = None

class FireRequest(BaseModel):
    net: NetModel
    transition_id: str
    marking: Optional[Dict[str,int]] = None

# ---- Analysis DTOs ----
class StateRequest(BaseModel):
    net: NetModel
    marking: Optional[Dict[str, int]] = None

class StateResponse(BaseModel):
    enabled: List[str]
    deadlocked: bool
    marking: Dict[str, int]

class KBoundRequest(BaseModel):
    net: NetModel
    marking: Optional[Dict[str, int]] = None
    k: Optional[int] = None            # if provided, check "is k-beschränkt?"
    max_depth: int = 50                # cutoffs to avoid blow-ups
    max_states: int = 10000

class KBoundResponse(BaseModel):
    explored_states: int
    depth_reached: int
    hit_limits: bool
    place_max: Dict[str, int]          # per-place maximum tokens observed
    minimal_k_observed: int            # max over place_max (lower bound for k)
    is_k_bounded: Optional[bool]       # True/False/None (unknown if cut off)
    is_safe: Optional[bool]            # True/False/None (unknown if cut off)
    reason: str

# --------- Engine ----------
class PetriNet:
    def __init__(self, net: NetModel):
        self.places = {p.id: p for p in net.places}
        self.transitions = {t.id: t for t in net.transitions}
        self.arcs = list(net.arcs)
        P, T = set(self.places), set(self.transitions)
        nodes = P | T
        for a in self.arcs:
            # must be place->transition or transition->place
            if (a.src in P and a.dst in P) or (a.src in T and a.dst in T):
                raise ValueError(f"Arc {a.id} must connect place<->transition (got {a.src}->{a.dst})")
            if a.src not in nodes: raise ValueError(f"Arc {a.id} src '{a.src}' not found")
            if a.dst not in nodes: raise ValueError(f"Arc {a.id} dst '{a.dst}' not found")

    def _marking(self) -> Dict[str,int]:
        return {pid: p.tokens for pid,p in self.places.items()}

    def enabled_transitions(self, marking: Optional[Dict[str,int]] = None):
        m = marking or self._marking()
        out = []
        for tid in self.transitions:
            ok = True
            for a in self.arcs:  # inputs p->tid
                if a.dst == tid and a.src in self.places:
                    if m.get(a.src, 0) < a.weight:
                        ok = False; break
            if ok: out.append(tid)
        return out

    def fire(self, tid: str, marking: Optional[Dict[str,int]] = None):
        if tid not in self.transitions: raise ValueError(f"Unknown transition '{tid}'")
        m = dict(marking or self._marking())
        if tid not in self.enabled_transitions(m): raise ValueError(f"Transition '{tid}' is not enabled")
        # consume
        for a in self.arcs:
            if a.dst == tid and a.src in self.places:
                m[a.src] = m.get(a.src, 0) - a.weight
        # produce
        for a in self.arcs:
            if a.src == tid and a.dst in self.places:
                m[a.dst] = m.get(a.dst, 0) + a.weight
        return m

# --------- Helpers for k-bounded ---------
def _norm_marking(place_ids: List[str], m: Dict[str, int]) -> Tuple[int, ...]:
    """Return a tuple in fixed place order for visited-set hashing."""
    return tuple(int(m.get(pid, 0)) for pid in place_ids)

# --------- API ----------
app = FastAPI(title="Petri API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Allow local dev + GitHub Pages + your Koyeb URL
    allow_origins=[
        "https://hannes307.github.io",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # include your deployed API host only if you call it from another site
        # "https://soviet-alicia-technischeuniversitaetwien-8e8e7575.koyeb.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
    max_age=600,
)

@app.get("/")
def root():
    return {"ok": True, "message": "FastAPI on Hugging Face Spaces is alive."}

@app.get("/health")
def health(): return {"status": "ok"}

# ---------- Simulation ----------
@app.post("/simulate/enabled")
def api_enabled(req: EnabledRequest):
    try:
        pn = PetriNet(req.net)
        m = req.marking or {p.id: p.tokens for p in req.net.places}
        if any(v < 0 for v in m.values()):
            raise HTTPException(status_code=400, detail="Negative tokens in marking")
        return {"enabled": pn.enabled_transitions(m)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/simulate/fire")
def api_fire(req: FireRequest):
    try:
        pn = PetriNet(req.net)
        m = pn.fire(req.transition_id, req.marking or {p.id: p.tokens for p in req.net.places})
        # return net with updated tokens
        net = {
            "places": [{"id":p.id,"label":p.label,"tokens":m.get(p.id,0)} for p in req.net.places],
            "transitions": [t.model_dump() for t in req.net.transitions],
            "arcs": [a.model_dump() for a in req.net.arcs],
        }
        return {"net": net, "marking": m}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---------- Analysis: deadlock/enabled ----------
@app.post("/analyze/state", response_model=StateResponse)
def analyze_state(req: StateRequest):
    try:
        pn = PetriNet(req.net)
        m = req.marking or {p.id: p.tokens for p in req.net.places}
        if any(v < 0 for v in m.values()):
            raise HTTPException(status_code=400, detail="Negative tokens in marking")
        en = pn.enabled_transitions(m)
        return StateResponse(enabled=en, deadlocked=(len(en) == 0), marking=m)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---------- Analysis: k-bounded / safe ----------
@app.post("/analyze/kbounded", response_model=KBoundResponse)
def analyze_kbounded(req: KBoundRequest):
    try:
        pn = PetriNet(req.net)
        place_ids = [p.id for p in req.net.places]
        if not place_ids:
            return KBoundResponse(
                explored_states=1,
                depth_reached=0,
                hit_limits=False,
                place_max={},
                minimal_k_observed=0,
                is_k_bounded=True if (req.k is None or req.k >= 0) else False,
                is_safe=True if req.k == 1 else None,
                reason="No places.",
            )

        # initial marking (defaults to net tokens)
        m0 = req.marking or {p.id: p.tokens for p in req.net.places}
        if any(v < 0 for v in m0.values()):
            raise HTTPException(status_code=400, detail="Negative tokens in initial marking")

        # BFS with cutoffs
        from collections import deque
        fringe = deque()
        visited = set()

        key0 = _norm_marking(place_ids, m0)
        visited.add(key0)
        fringe.append(m0)

        maxima = {pid: int(m0.get(pid, 0)) for pid in place_ids}
        explored = 0
        depth_reached = 0
        hit_limits = False
        depth_layer = {key0: 0}

        while fringe:
            m = fringe.popleft()
            key = _norm_marking(place_ids, m)
            d = depth_layer[key]
            depth_reached = max(depth_reached, d)
            explored += 1

            if explored >= req.max_states:
                hit_limits = True
                break
            if d >= req.max_depth:
                hit_limits = True
                continue

            # update per-place maxima
            for pid in place_ids:
                v = int(m.get(pid, 0))
                if v > maxima[pid]:
                    maxima[pid] = v

            # expand successors
            enabled = pn.enabled_transitions(m)
            for tid in enabled:
                m2 = pn.fire(tid, m)
                k2 = _norm_marking(place_ids, m2)
                if k2 in visited:
                    continue
                visited.add(k2)
                fringe.append(m2)
                depth_layer[k2] = d + 1

        minimal_k_observed = max(maxima.values()) if maxima else 0

        # Decide results
        if not hit_limits:
            # fully explored => bounded; minimal k is exact
            if req.k is not None:
                is_k = (req.k >= minimal_k_observed)
            else:
                is_k = None
            is_safe = (minimal_k_observed <= 1)
            reason = f"Explored entire reachable space; bounded with minimal k = {minimal_k_observed}"
        else:
            # cut off => only a lower bound for k
            if req.k is not None:
                if req.k < minimal_k_observed:
                    is_k = False
                    reason = f"Observed place requires k≥{minimal_k_observed}; supplied k={req.k} is too small."
                else:
                    is_k = None
                    reason = f"Search cut off; minimal observed k={minimal_k_observed}. Cannot prove k-bounded."
            else:
                is_k = None
                reason = f"Search cut off; minimal observed k={minimal_k_observed}. Boundedness unknown."
            # safe: definite no if lower bound > 1; otherwise unknown
            is_safe = (False if minimal_k_observed > 1 else None)

        return KBoundResponse(
            explored_states=explored,
            depth_reached=depth_reached,
            hit_limits=hit_limits,
            place_max=maxima,
            minimal_k_observed=minimal_k_observed,
            is_k_bounded=is_k,
            is_safe=is_safe,
            reason=reason,
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
