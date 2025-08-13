from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

class PlaceModel(BaseModel):
    id: str
    label: str
    tokens: int = 0
    @field_validator('tokens')
    def non_negative_tokens(cls, v):
        if v < 0:
            raise ValueError("tokens must be >= 0")
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
    def positive_weight(cls, v):
        if v <= 0:
            raise ValueError("weight must be >= 1")
        return v

class NetModel(BaseModel):
    places: List[PlaceModel]
    transitions: List[TransitionModel]
    arcs: List[ArcModel]

class FireRequest(BaseModel):
    net: NetModel
    transition_id: str

class PetriNet:
    def __init__(self, net: NetModel):
        self.places: Dict[str, PlaceModel] = {p.id: p for p in net.places}
        self.transitions: Dict[str, TransitionModel] = {t.id: t for t in net.transitions}
        self.arcs: List[ArcModel] = list(net.arcs)
        place_ids = set(self.places.keys())
        trans_ids = set(self.transitions.keys())
        for a in self.arcs:
            if (a.src in place_ids and a.dst in place_ids) or (a.src in trans_ids and a.dst in trans_ids):
                raise ValueError(f"Arc {a.id} must connect place<->transition")
            if a.src not in place_ids | trans_ids:
                raise ValueError(f"Arc {a.id} src '{a.src}' not found")
            if a.dst not in place_ids | trans_ids:
                raise ValueError(f"Arc {a.id} dst '{a.dst}' not found")

    def _marking(self) -> Dict[str, int]:
        return {pid: p.tokens for pid, p in self.places.items()}

    def enabled_transitions(self, marking: Optional[Dict[str, int]] = None) -> List[str]:
        m = marking or self._marking()
        enabled = []
        for tid in self.transitions.keys():
            ok = True
            for a in self.arcs:
                if a.dst == tid and a.src in self.places:
                    if m.get(a.src, 0) < a.weight:
                        ok = False
                        break
            if ok:
                enabled.append(tid)
        return enabled

    def fire(self, transition_id: str, marking: Optional[Dict[str, int]] = None) -> Dict[str, int]:
        m = dict(marking or self._marking())
        if transition_id not in self.transitions:
            raise ValueError(f"Unknown transition '{transition_id}'")
        if transition_id not in self.enabled_transitions(m):
            raise ValueError(f"Transition '{transition_id}' is not enabled")
        for a in self.arcs:
            if a.dst == transition_id and a.src in self.places:
                m[a.src] = m.get(a.src, 0) - a.weight
        for a in self.arcs:
            if a.src == transition_id and a.dst in self.places:
                m[a.dst] = m.get(a.dst, 0) + a.weight
        return m

app = FastAPI(title="Petri Net Simulator API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/simulate/enabled")
async def api_enabled(net: NetModel):
    try:
        pn = PetriNet(net)
        return {"enabled": pn.enabled_transitions()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/simulate/fire")
async def api_fire(req: FireRequest):
    try:
        pn = PetriNet(req.net)
        new_marking = pn.fire(req.transition_id)
        result_places = [
            {"id": p.id, "label": p.label, "tokens": new_marking.get(p.id, 0)}
            for p in req.net.places
        ]
        return {"marking": new_marking, "places": result_places}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
