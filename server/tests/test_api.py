import io

import pyembroidery
import pytest
from fastapi.testclient import TestClient

from stitchpro_server import main
from stitchpro_server.main import app
from stitchpro_server.writer import FORMATS, pattern_stitch_points, reader_for

client = TestClient(app)


def zigzag(x0, y0, width, height, step=2.0):
    """Stitch commands zigzagging across a width x height box."""
    cmds = []
    y = y0
    left = True
    while y <= y0 + height + 1e-9:
        cmds.append(["stitch", x0 if left else x0 + width, y])
        left = not left
        y += step
    return cmds


def sample_plan(**overrides):
    commands = (
        [["jump", 0, 0]]
        + zigzag(0, 0, 20, 10)
        + [["trim", 20, 10], ["color_change", 20, 10], ["jump", 40, 0]]
        + zigzag(40, 0, 10, 10)
        + [["stop", 50, 10]]
        + zigzag(40, 12, 10, 4)
        + [["trim", 50, 16]]
    )
    plan = {
        "name": "Round trip",
        "threads": [
            {"color": [200, 16, 46], "name": "Poppy", "brand": "Isacord", "code": "1902"},
            {"color": [0, 94, 184], "name": "Blue", "brand": "Isacord", "code": "3622"},
        ],
        "commands": commands,
        "autoJump": True,
        "maxStitch": 12.0,
        "trimJumps": 3,
    }
    plan.update(overrides)
    return plan


def extent(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return max(xs) - min(xs), max(ys) - min(ys)


@pytest.mark.parametrize("fmt", FORMATS)
def test_export_round_trip(fmt):
    plan = sample_plan()
    r = client.post(f"/api/export/{fmt}", json=plan)
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"] == f'attachment; filename="Round trip.{fmt}"'
    assert len(r.content) > 0

    # The written file holds the same stitches, in absolute positions.
    pattern = reader_for(fmt)(io.BytesIO(r.content))
    width, height = extent(pattern_stitch_points(pattern))
    assert width == pytest.approx(50, abs=0.2)
    assert height == pytest.approx(16, abs=0.2)

    # And it imports back into runs.
    back = client.post(f"/api/import/{fmt}", content=r.content)
    assert back.status_code == 200, back.text
    data = back.json()
    planned = sum(1 for c in plan["commands"] if c[0] == "stitch")
    assert data["stitches"] >= planned
    # Split at the trim/colour change and at the stop (VP3 has no stop command, so it has one fewer).
    assert len(data["runs"]) >= (2 if fmt == "vp3" else 3)
    all_points = [p for run in data["runs"] for p in run["points"]]
    w2, h2 = extent(all_points)
    assert w2 == pytest.approx(50, abs=0.2)
    assert h2 == pytest.approx(16, abs=0.2)


@pytest.mark.parametrize("fmt", FORMATS)
def test_read_back_matches_every_stitch(fmt):
    """Written, read back and compared: every planned stitch comes back, in order, within 0.1 mm,
    in the same colour block; long stitches may come back split by the writer."""
    plan = sample_plan()
    r = client.post(f"/api/export/{fmt}", json=plan)
    data = client.post(f"/api/import/{fmt}", content=r.content).json()
    back = [(p, run["thread"]) for run in data["runs"] for p in run["points"]]

    # These formats write a stop as a colour change, so it reads back as a new colour block.
    stop_is_change = fmt in ("dst", "exp", "xxx")
    planned = []
    block = 0
    for kind, x, y in plan["commands"]:
        if kind == "color_change" or (kind == "stop" and stop_is_change):
            block += 1
        elif kind == "stitch":
            planned.append(((x, y), block))

    i = 0
    for (x, y), b in planned:
        while i < len(back) and not (abs(back[i][0][0] - x) <= 0.1 and abs(back[i][0][1] - y) <= 0.1):
            i += 1
        assert i < len(back), f"{fmt}: stitch ({x}, {y}) missing after reading back"
        assert back[i][1] == b, f"{fmt}: stitch ({x}, {y}) came back in colour block {back[i][1]}, not {b}"
        i += 1
    # Nothing beyond the design's extent was added.
    xs = [p[0] for p, _ in back]
    ys = [p[1] for p, _ in back]
    assert min(xs) >= -0.1 and max(xs) <= 50.1 and min(ys) >= -0.1 and max(ys) <= 16.1


@pytest.mark.parametrize("fmt", ["pes", "vp3"])
def test_thread_colours_round_trip(fmt):
    r = client.post(f"/api/export/{fmt}", json=sample_plan())
    data = client.post(f"/api/import/{fmt}", content=r.content).json()
    colours = [t["color"] for t in data["threads"]]
    assert [200, 16, 46] in colours
    assert [0, 94, 184] in colours


def test_pes_is_version_6():
    r = client.post("/api/export/pes", json=sample_plan())
    assert r.content[:8] == b"#PES0060"


def test_long_stitches_are_jumped_or_sewn_to():
    commands = [["jump", 0, 0], ["stitch", 0, 0], ["stitch", 30, 0], ["stitch", 30, 5], ["trim", 30, 5]]
    for auto_jump in (True, False):
        plan = sample_plan(commands=commands, autoJump=auto_jump)
        r = client.post("/api/export/dst", json=plan)
        assert r.status_code == 200, r.text
        pattern = pyembroidery.read_dst(io.BytesIO(r.content))
        width, _ = extent(pattern_stitch_points(pattern) or [(0, 0)])
        if not auto_jump:
            # Sewn to: the long stitch is split into stitches no longer than 12 mm.
            assert width == pytest.approx(30, abs=0.2)


def test_far_moves_use_absolute_positions():
    commands = [["jump", 0, 0], ["stitch", 0, 0], ["stitch", 1, 0], ["trim", 1, 0], ["jump", 150, 80], ["stitch", 150, 80], ["stitch", 152, 80]]
    for fmt in FORMATS:
        r = client.post(f"/api/export/{fmt}", json=sample_plan(commands=commands))
        assert r.status_code == 200, (fmt, r.text)
        width, height = extent(pattern_stitch_points(reader_for(fmt)(io.BytesIO(r.content))))
        assert width == pytest.approx(152, abs=0.2), fmt
        assert height == pytest.approx(80, abs=0.2), fmt


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "x" * 201},
        {"threads": [{"color": [0, 0, 0]}] * 1001},
        {"maxStitch": 201},
        {"maxStitch": -1},
        {"trimJumps": 0},
        {"trimJumps": 11},
        {"commands": [["stitch", 2001, 0]]},
        {"commands": [["stitch", 0, -2001]]},
        {"commands": [["sew", 0, 0]]},
        {"threads": [{"color": [256, 0, 0]}]},
    ],
)
def test_export_validates_the_plan(overrides):
    assert client.post("/api/export/dst", json=sample_plan(**overrides)).status_code == 422


def test_export_rejects_unknown_formats_and_empty_designs():
    assert client.post("/api/export/svg", json=sample_plan()).status_code == 404
    r = client.post("/api/export/dst", json=sample_plan(commands=[["jump", 0, 0]]))
    assert r.status_code == 500
    assert "no stitches" in r.json()["detail"]


def test_export_checks_entitlement(monkeypatch):
    monkeypatch.setattr(main, "entitled", lambda plan: False)
    assert client.post("/api/export/dst", json=sample_plan()).status_code == 402


def test_import_rejects_oversized_and_bad_files():
    assert client.post("/api/import/dst", content=b"\0" * (20 * 1024 * 1024 + 1)).status_code == 413
    assert client.post("/api/import/dst", content=b"").status_code == 400
    assert client.post("/api/import/pes", content=b"not an embroidery file").status_code == 400
    assert client.post("/api/import/abc", content=b"x").status_code == 404


def test_import_treats_two_colour_changes_as_a_stop():
    pattern = pyembroidery.EmbPattern()
    for x in (0, 10, 20):
        pattern.stitch_abs(x, 0)
    pattern.color_change()
    pattern.color_change()
    for x in (30, 40):
        pattern.stitch_abs(x, 0)
    pattern.end()
    stream = io.BytesIO()
    pyembroidery.write_exp(pattern, stream)
    data = client.post("/api/import/exp", content=stream.getvalue()).json()
    assert [run["stop"] for run in data["runs"]] == [True, False]
    assert [run["thread"] for run in data["runs"]] == [0, 0]


def test_fonts_list_save_read_and_conflict(tmp_path, monkeypatch):
    monkeypatch.setenv("STITCHPRO_FONTS_DIR", str(tmp_path))
    assert client.get("/api/fonts").json() == {"fonts": []}
    font = {"format": "stitchpro-font", "version": 1, "name": "My Script", "glyphs": {}}
    r = client.post("/api/fonts", json=font)
    assert r.status_code == 200
    assert r.json() == {"file": "My Script.spf"}
    assert (tmp_path / "My Script.spf").is_file()
    assert client.get("/api/fonts").json() == {"fonts": [{"name": "My Script", "file": "My Script.spf"}]}
    assert client.get("/api/fonts/My Script.spf").json()["name"] == "My Script"
    assert client.post("/api/fonts", json=font).status_code == 409
    font["version"] = 2
    assert client.post("/api/fonts?overwrite=true", json=font).status_code == 200
    assert client.get("/api/fonts/My Script.spf").json()["version"] == 2


def test_fonts_reject_bad_input(tmp_path, monkeypatch):
    monkeypatch.setenv("STITCHPRO_FONTS_DIR", str(tmp_path))
    assert client.post("/api/fonts", json={"format": "stitchpro-font", "name": ""}).status_code == 422
    assert client.post("/api/fonts", json={"format": "other", "name": "x"}).status_code == 422
    assert client.get("/api/fonts/..%2F..%2Fsecret.spf").status_code == 404
    assert client.get("/api/fonts/missing.spf").status_code == 404
    # Names are made safe for the file system.
    r = client.post("/api/fonts", json={"format": "stitchpro-font", "name": "../../evil"})
    assert r.json()["file"] == "evil.spf"
    assert (tmp_path / "evil.spf").is_file()
