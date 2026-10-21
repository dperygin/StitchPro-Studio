"""The API."""

from fastapi import FastAPI

from .writer import FORMATS

app = FastAPI(title="StitchPro Studio API")


def entitled(plan: dict) -> bool:
    """The single paywall check for machine-file downloads.

    Every download is allowed for now. Accounts and per-design payments plug in here later.
    """
    return True


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/formats")
def formats() -> dict:
    return {"formats": list(FORMATS)}
