"""Saved native fonts (.spf JSON files) in fonts_spf/ (STITCHPRO_FONTS_DIR overrides)."""

import json
import os
import re
from pathlib import Path

#: The repository's local-only folder for fonts saved from the font editor.
DEFAULT_FONTS_DIR = Path(__file__).resolve().parents[2] / "fonts_spf"

_SAFE = re.compile(r"[^A-Za-z0-9 _.-]+")


class FontExists(Exception):
    """A font with this name is already saved."""


def fonts_dir() -> Path:
    return Path(os.environ.get("STITCHPRO_FONTS_DIR") or DEFAULT_FONTS_DIR)


def file_name(name: str) -> str:
    """A safe file name for a font name (no paths, no reserved characters)."""
    stem = _SAFE.sub("_", name).strip(" ._") or "font"
    return stem[:100] + ".spf"


def list_fonts() -> list[dict]:
    folder = fonts_dir()
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.spf")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            name = data.get("name") if isinstance(data, dict) else None
        except (OSError, ValueError):
            continue
        out.append({"name": name or path.stem, "file": path.name})
    return out


def read_font(file: str) -> dict | None:
    if file != Path(file).name or not file.endswith(".spf"):
        return None
    path = fonts_dir() / file
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_font(font: dict, overwrite: bool = False) -> str:
    """Saves a font; returns its file name. Raises FontExists unless overwrite."""
    name = str(font.get("name") or "")
    folder = fonts_dir()
    folder.mkdir(parents=True, exist_ok=True)
    file = file_name(name)
    path = folder / file
    if path.exists() and not overwrite:
        raise FontExists(name)
    path.write_text(json.dumps(font, indent=2) + "\n", encoding="utf-8")
    return file
