"""
REST API routes for cache operations and simulation triggers.
"""

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()


# ─── Pydantic models ──────────────────────────────────────────────────────────

class SetPayload(BaseModel):
    value: Any
    ttl: Optional[float] = Field(default=None, ge=0)


class SimulatePayload(BaseModel):
    params: dict = Field(default_factory=dict)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _store(req: Request):
    return req.app.state.cache

def _engine(req: Request):
    return req.app.state.engine


# ─── Cache CRUD ───────────────────────────────────────────────────────────────

@router.get("/api/cache")
async def list_entries(req: Request):
    return _store(req).get_all()


@router.get("/api/cache/{key}")
async def get_entry(key: str, req: Request):
    store = _store(req)
    value = store.get(key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found or expired")
    # Re-fetch the full entry dict for metadata.
    with store._rwlock.read_lock():
        entry = store._data.get(key)
        if entry is None:
            raise HTTPException(status_code=404, detail=f"Key '{key}' not found")
        return entry.to_dict()


@router.put("/api/cache/{key}")
async def set_entry(key: str, payload: SetPayload, req: Request):
    entry = _store(req).set(key, payload.value, ttl=payload.ttl)
    return entry.to_dict()


@router.delete("/api/cache/{key}")
async def delete_entry(key: str, req: Request):
    deleted = _store(req).delete(key)
    return {"deleted": deleted}


@router.delete("/api/cache")
async def clear_all(req: Request):
    count = _store(req).clear()
    return {"cleared": count}


# ─── Metrics ──────────────────────────────────────────────────────────────────

@router.get("/api/metrics")
async def get_metrics(req: Request):
    return _store(req).stats()


@router.get("/api/metrics/history")
async def get_history(req: Request):
    return {"points": _store(req).history()}


@router.post("/api/metrics/reset")
async def reset_metrics(req: Request):
    _store(req).metrics.reset()
    return {"ok": True}


# ─── Simulations ──────────────────────────────────────────────────────────────

SCENARIO_MAP = {
    "stampede": "_run_stampede",
    "lost_update": "_run_lost_update",
    "deadlock": "_run_deadlock",
    "rw_contention": "_run_rw_contention",
    "expiration_storm": "_run_expiration_storm",
    "eviction_pressure": "_run_eviction_pressure",
}


@router.post("/api/simulate/{scenario_id}")
async def run_scenario(scenario_id: str, payload: SimulatePayload, req: Request):
    if scenario_id not in SCENARIO_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    engine = _engine(req)
    if engine.is_running(scenario_id):
        raise HTTPException(status_code=409, detail=f"Scenario '{scenario_id}' already running")

    params = payload.params
    loop = asyncio.get_event_loop()

    # Dispatch to correct scenario runner in a thread (all are blocking).
    if scenario_id == "stampede":
        loop.run_in_executor(
            None, lambda: engine.run_stampede(
                n_threads=int(params.get("n_threads", 40)),
                protected=bool(params.get("protected", False)),
                regen_delay=float(params.get("regen_delay", 0.3)),
            )
        )
    elif scenario_id == "lost_update":
        loop.run_in_executor(
            None, lambda: engine.run_lost_update(
                n_threads=int(params.get("n_threads", 50)),
                use_lock=bool(params.get("use_lock", False)),
            )
        )
    elif scenario_id == "deadlock":
        loop.run_in_executor(
            None, lambda: engine.run_deadlock(
                timeout=float(params.get("timeout", 3.0)),
            )
        )
    elif scenario_id == "rw_contention":
        loop.run_in_executor(
            None, lambda: engine.run_rw_contention(
                n_readers=int(params.get("n_readers", 30)),
                n_writers=int(params.get("n_writers", 3)),
                duration=float(params.get("duration", 5.0)),
            )
        )
    elif scenario_id == "expiration_storm":
        loop.run_in_executor(
            None, lambda: engine.run_expiration_storm(
                n_keys=int(params.get("n_keys", 100)),
                ttl=float(params.get("ttl", 4.0)),
            )
        )
    elif scenario_id == "eviction_pressure":
        loop.run_in_executor(
            None, lambda: engine.run_eviction_pressure(
                n_keys=int(params.get("n_keys", 600)),
                max_size=int(params.get("max_size", 200)),
            )
        )

    return {"accepted": True, "scenario": scenario_id}


@router.get("/api/simulate/{scenario_id}")
async def scenario_status(scenario_id: str, req: Request):
    if scenario_id not in SCENARIO_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    engine = _engine(req)
    return {
        "scenario": scenario_id,
        "running": engine.is_running(scenario_id),
    }


@router.delete("/api/simulate/{scenario_id}")
async def stop_scenario(scenario_id: str, req: Request):
    if scenario_id not in SCENARIO_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    _engine(req).stop(scenario_id)
    return {"stopped": True}


@router.delete("/api/simulate")
async def stop_all(req: Request):
    stopped = _engine(req).stop_all()
    return {"stopped": stopped}
