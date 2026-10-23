from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import api_admin, api_carpip, api_native, api_zoho, db, migrate, workers
from .domain import ErpError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s [%(name)s] %(message)s")

app = FastAPI(title="Demo Wholesale ERP", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ErpError)
async def _erp_error(_: Request, e: ErpError):
    return JSONResponse({"code": e.code, "detail": e.detail}, status_code=e.status)


@app.exception_handler(HTTPException)
async def _http_error(_: Request, e: HTTPException):
    body = e.detail if isinstance(e.detail, dict) else {"code": "ERROR", "detail": str(e.detail)}
    return JSONResponse(body, status_code=e.status_code)


@app.on_event("startup")
def _startup() -> None:
    db.wait_for_db()
    migrate.migrate()
    workers.start()


@app.get("/healthz")
def healthz():
    return {"status": "UP", "service": "erp-backend"}


app.include_router(api_native.router)
app.include_router(api_admin.router)
app.include_router(api_carpip.router)
app.include_router(api_zoho.router)
