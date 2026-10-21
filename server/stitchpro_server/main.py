"""The API."""

import re

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import Response

from . import fonts
from .plan import ExportPlan
from .reader import MAX_IMPORT_BYTES, ImportError_, read_file
from .writer import FORMATS, ExportError, write_file

app = FastAPI(title="StitchPro Studio API")


def entitled(plan: ExportPlan) -> bool:
    """The single paywall check for machine-file downloads.

    Every download is allowed for now. Accounts and per-design payments plug in here later
    (one payment covers every format of one design; stored designs download again free).
    """
    return True


def _check_format(fmt: str) -> str:
    fmt = fmt.lower()
    if fmt not in FORMATS:
        raise HTTPException(404, f"Unknown format '{fmt}'. Supported: {', '.join(FORMATS)}.")
    return fmt


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/formats")
def formats() -> dict:
    return {"formats": list(FORMATS)}


@app.post("/api/export/{fmt}")
def export(fmt: str, plan: ExportPlan) -> Response:
    fmt = _check_format(fmt)
    if not entitled(plan):
        raise HTTPException(402, "Downloading this design needs a payment.")
    try:
        data = write_file(fmt, plan)
    except ExportError as e:
        raise HTTPException(500, str(e)) from e
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "_", plan.name).strip() or "design"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{stem}.{fmt}"'},
    )


@app.post("/api/import/{fmt}")
async def import_file(fmt: str, request: Request) -> dict:
    fmt = _check_format(fmt)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "The file is larger than 20 MB.")
    if not data:
        raise HTTPException(400, "The file is empty.")
    try:
        return read_file(fmt, bytes(data))
    except ImportError_ as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/fonts")
def list_fonts() -> dict:
    return {"fonts": fonts.list_fonts()}


@app.get("/api/fonts/{file}")
def read_font(file: str) -> dict:
    font = fonts.read_font(file)
    if font is None:
        raise HTTPException(404, f"No saved font '{file}'.")
    return font


@app.post("/api/fonts")
def save_font(font: dict = Body(...), overwrite: bool = False) -> dict:
    if not isinstance(font.get("name"), str) or not font["name"].strip():
        raise HTTPException(422, "A font needs a name.")
    if font.get("format") != "stitchpro-font":
        raise HTTPException(422, "Not a StitchPro font (format must be 'stitchpro-font').")
    try:
        file = fonts.save_font(font, overwrite=overwrite)
    except fonts.FontExists as e:
        raise HTTPException(409, f"A font named '{e}' already exists.") from e
    return {"file": file}
