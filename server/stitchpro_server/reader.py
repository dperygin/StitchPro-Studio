"""Machine file -> needle runs."""

import io

from pyembroidery import COLOR_CHANGE, COMMAND_MASK, END, JUMP, STITCH, STOP, TRIM

from .writer import reader_for

#: Largest machine file accepted for import, bytes.
MAX_IMPORT_BYTES = 20 * 1024 * 1024


class ImportError_(Exception):
    """The file could not be read."""


def read_file(fmt: str, data: bytes) -> dict:
    """Reads a machine file into {threads, runs [{thread, points, stop}], stitches}, in mm.

    Runs split at jumps, trims, stops and colour changes. Two colour changes with nothing
    sewn between them count as a stop (no change of thread).
    """
    try:
        pattern = reader_for(fmt)(io.BytesIO(data))
    except Exception as e:  # pyembroidery raises many kinds of errors on bad input
        raise ImportError_(f"This is not a readable {fmt.upper()} file ({e}).") from e
    if pattern is None:
        raise ImportError_(f"This is not a readable {fmt.upper()} file.")

    threads = []
    for t in pattern.threadlist:
        c = t.color & 0xFFFFFF
        threads.append(
            {
                "color": [(c >> 16) & 255, (c >> 8) & 255, c & 255],
                "name": t.description or "",
                "brand": t.brand or t.chart or "",
                "code": t.catalog_number or "",
            }
        )

    runs: list[dict] = []
    current: list[list[float]] = []
    thread = 0
    stitches = 0
    pending_change = False  # a colour change seen with nothing sewn since

    def close(stop: bool = False) -> None:
        nonlocal current
        if current:
            runs.append({"thread": thread, "points": current, "stop": stop})
        elif stop and runs:
            runs[-1]["stop"] = True
        current = []

    for x, y, cmd in pattern.stitches:
        command = cmd & COMMAND_MASK
        if command == STITCH:
            if pending_change:
                thread += 1
                pending_change = False
            current.append([x / 10, y / 10])
            stitches += 1
        elif command in (JUMP, TRIM):
            close()
        elif command == STOP:
            close(stop=True)
        elif command == COLOR_CHANGE:
            close()
            if pending_change:
                # Two colour changes with nothing between: a stop, not a new thread.
                pending_change = False
                if runs:
                    runs[-1]["stop"] = True
            else:
                pending_change = True
        elif command == END:
            break
    close()
    return {"threads": threads, "runs": runs, "stitches": stitches}
