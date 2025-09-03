from typing import List, Dict, Optional
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

# --------- API ----------
app = FastAPI(title="Petri API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Allow local dev + GitHub Pages + your Koyeb URL
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://hannes307.github.io",
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

@app.post("/simulate/enabled")
def api_enabled(req: EnabledRequest):
    pn = PetriNet(req.net)
    return {"enabled": pn.enabled_transitions(req.marking)}

@app.post("/simulate/fire")
def api_fire(req: FireRequest):
    pn = PetriNet(req.net)
    m = pn.fire(req.transition_id, req.marking)
    # return net with updated tokens
    net = {
        "places": [{"id":p.id,"label":p.label,"tokens":m.get(p.id,0)} for p in req.net.places],
        "transitions": [t.model_dump() for t in req.net.transitions],
        "arcs": [a.model_dump() for a in req.net.arcs],
    }
    return {"net": net, "marking": m}
