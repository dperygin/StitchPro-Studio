"""Export plan -> machine file. The only place machine files are written."""

import io

import pyembroidery
from pyembroidery import (
    COMMAND_MASK,
    CONTINGENCY_LONG_STITCH_JUMP_NEEDLE,
    CONTINGENCY_LONG_STITCH_SEW_TO,
    STITCH,
    EmbPattern,
    EmbThread,
)
from pyembroidery import DstWriter, ExpWriter, JefWriter, PesWriter, Vp3Writer, XxxWriter

from .plan import ExportPlan

FORMATS = ("dst", "pes", "exp", "jef", "vp3", "xxx")

# fmt -> (writer module, write function, read function). Limits come from the writer module.
_FORMATS = {
    "dst": (DstWriter, pyembroidery.write_dst, pyembroidery.read_dst),
    "pes": (PesWriter, pyembroidery.write_pes, pyembroidery.read_pes),
    "exp": (ExpWriter, pyembroidery.write_exp, pyembroidery.read_exp),
    "jef": (JefWriter, pyembroidery.write_jef, pyembroidery.read_jef),
    "vp3": (Vp3Writer, pyembroidery.write_vp3, pyembroidery.read_vp3),
    "xxx": (XxxWriter, pyembroidery.write_xxx, pyembroidery.read_xxx),
}

#: Read-back extent must match the plan within this, mm.
EXTENT_TOLERANCE = 0.2


class ExportError(Exception):
    """The file could not be written correctly."""


def reader_for(fmt: str):
    return _FORMATS[fmt][2]


def build_pattern(plan: ExportPlan) -> EmbPattern:
    """A pyembroidery pattern in 0.1 mm units, using ABSOLUTE stitch/move positions only."""
    pattern = EmbPattern()
    for t in plan.threads:
        thread = EmbThread()
        thread.set_color(*t.color)
        thread.description = t.name
        thread.brand = t.brand
        thread.chart = t.brand
        thread.catalog_number = t.code
        pattern.add_thread(thread)
    for kind, x, y in plan.commands:
        if kind == "stitch":
            pattern.stitch_abs(x * 10, y * 10)
        elif kind == "jump":
            pattern.move_abs(x * 10, y * 10)
        elif kind == "trim":
            pattern.trim()
        elif kind == "stop":
            pattern.stop()
        elif kind == "color_change":
            pattern.color_change()
    pattern.end()
    return pattern


def write_settings(fmt: str, plan: ExportPlan) -> dict:
    writer = _FORMATS[fmt][0]
    settings = {
        # The plan's limit in 0.1 mm, never more than the format allows.
        "max_stitch": min(plan.maxStitch * 10, writer.MAX_STITCH_DISTANCE),
        "long_stitch_contingency": CONTINGENCY_LONG_STITCH_JUMP_NEEDLE if plan.autoJump else CONTINGENCY_LONG_STITCH_SEW_TO,
        "trims": True,
        "trim_at": plan.trimJumps,
    }
    if fmt == "pes":
        settings["version"] = 6
    return settings


def stitch_extent(points) -> tuple[float, float, float, float] | None:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def pattern_stitch_points(pattern: EmbPattern) -> list[tuple[float, float]]:
    """Needle penetrations of a pattern, in mm."""
    return [(s[0] / 10, s[1] / 10) for s in pattern.stitches if (s[2] & COMMAND_MASK) == STITCH]


def write_file(fmt: str, plan: ExportPlan) -> bytes:
    """Writes the plan, reads the file back and checks its stitch extent against the plan."""
    if fmt not in _FORMATS:
        raise KeyError(fmt)
    write = _FORMATS[fmt][1]
    stream = io.BytesIO()
    write(build_pattern(plan), stream, write_settings(fmt, plan))
    data = stream.getvalue()

    expected = stitch_extent([(x, y) for kind, x, y in plan.commands if kind == "stitch"])
    actual = stitch_extent(pattern_stitch_points(reader_for(fmt)(io.BytesIO(data))))
    if expected is None:
        raise ExportError("The design has no stitches.")
    if actual is None:
        raise ExportError("The written file has no stitches.")
    # Some formats re-centre the design, so compare the size of the stitch extent.
    for name, want, got in (
        ("width", expected[2] - expected[0], actual[2] - actual[0]),
        ("height", expected[3] - expected[1], actual[3] - actual[1]),
    ):
        if abs(want - got) > EXTENT_TOLERANCE:
            raise ExportError(f"The {fmt.upper()} file's stitch {name} is {got:.2f} mm, expected {want:.2f} mm.")
    return data
