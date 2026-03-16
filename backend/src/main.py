"""
FastAPI application entry point.

Wires together:
  - CacheStore (the in-memory cache)
  - SimulationEngine (contention scenarios)
  - ConnectionManager (WebSocket fan-out)
  - REST routes
"""

import asyncio

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .cache import CacheStore, SimulationEngine
from .api.routes import router
from .api.websocket import manager

app = FastAPI(
    title="Cache Contention Lab API",
    description="Thread-safe in-memory cache with contention scenario demonstrations.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def startup() -> None:
    # Shared cache store.
    store = CacheStore(max_size=500, cleanup_interval=2.0)

    # Hook store events into the WebSocket broadcaster.
    store.add_callback(manager.enqueue)

    # Simulation engine.
    engine = SimulationEngine(store=store, emit=manager.enqueue)

    # Attach to app state so routes can access them.
    app.state.cache = store
    app.state.engine = engine

    # Start WebSocket broadcast loop as a background task.
    asyncio.create_task(manager.broadcast_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    app.state.cache.shutdown()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.handle_client(ws)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
