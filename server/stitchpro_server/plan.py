"""The export plan sent by the browser: validated before anything is written.

Coordinates are millimetres, y down (screen convention), exactly as the engine produces them.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

Coordinate = Annotated[float, Field(ge=-2000, le=2000, allow_inf_nan=False)]
CommandKind = Literal["stitch", "jump", "trim", "stop", "color_change"]
Command = tuple[CommandKind, Coordinate, Coordinate]
Channel = Annotated[int, Field(ge=0, le=255)]


class Thread(BaseModel):
    color: tuple[Channel, Channel, Channel]
    name: Annotated[str, Field(max_length=200)] = ""
    brand: Annotated[str, Field(max_length=200)] = ""
    code: Annotated[str, Field(max_length=200)] = ""


class ExportPlan(BaseModel):
    name: Annotated[str, Field(max_length=200)]
    threads: Annotated[list[Thread], Field(max_length=1000)]
    commands: Annotated[list[Command], Field(max_length=2_000_000)]
    autoJump: bool = True
    maxStitch: Annotated[float, Field(ge=0, le=200, allow_inf_nan=False)] = 12.0
    trimJumps: Annotated[int, Field(ge=1, le=10)] = 3
