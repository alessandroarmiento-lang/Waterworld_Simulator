#!/usr/bin/env python3
"""Count active Cursor hours from agent transcripts (Minda method).

Method:
  - Collect message timestamps from Cursor chat transcripts.
  - Gap > 30 min ends a work block (pause not counted).
  - Inside a block, each gap is credited up to 10 min.
  - Add 3 min after the last message of a block.
  - Traditional equivalent = Cursor hours × 5.

Usage (from project root):
  python3 deploy/count_work_hours.py
  python3 deploy/count_work_hours.py --match Rigo-Project --match schermo-per-scrivere
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

GAP_END_BLOCK = timedelta(minutes=30)
GAP_CREDIT_CAP = timedelta(minutes=10)
TAIL = timedelta(minutes=3)
CURSOR_TO_TRADITIONAL = 5

TS_TAG = re.compile(
    r"<timestamp>\s*([^<]+?)\s*</timestamp>",
    re.IGNORECASE,
)
ISO_KEYS = ("timestamp", "createdAt", "created_at", "time")


def parse_ts(raw: str) -> datetime | None:
    raw = raw.strip()
    # Chat stamps read "… 2:14 AM (UTC+2)": that offset is what makes the wall clock
    # meaningful. Dropping it and calling the result UTC moved sessions by two hours
    # and pushed late-night work onto the wrong day.
    offset = None
    tz_match = re.search(r"\s*\(UTC([+-])(\d{1,2})(?::?(\d{2}))?\)\s*$", raw)
    if tz_match:
        sign = 1 if tz_match.group(1) == "+" else -1
        hours = int(tz_match.group(2))
        minutes = int(tz_match.group(3) or 0)
        offset = timezone(sign * timedelta(hours=hours, minutes=minutes))
        raw = raw[: tz_match.start()].strip()
    formats = (
        "%A, %b %d, %Y, %I:%M %p",
        "%A, %B %d, %Y, %I:%M %p",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
    )
    for fmt in formats:
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=offset or timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def walk_for_ts(obj) -> list[datetime]:
    found: list[datetime] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ISO_KEYS and isinstance(v, str):
                dt = parse_ts(v)
                if dt:
                    found.append(dt)
            found.extend(walk_for_ts(v))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(walk_for_ts(item))
    elif isinstance(obj, str):
        for m in TS_TAG.finditer(obj):
            dt = parse_ts(m.group(1))
            if dt:
                found.append(dt)
    return found


def collect_timestamps(transcript_roots: list[Path]) -> list[datetime]:
    stamps: list[datetime] = []
    for root in transcript_roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*.jsonl"):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    stamps.extend(
                        parse_ts(m.group(1))
                        for m in TS_TAG.finditer(line)
                        if parse_ts(m.group(1))
                    )
                    continue
                stamps.extend(walk_for_ts(data))
    uniq = sorted(set(stamps))
    return uniq


def blocks_from(stamps: list[datetime]) -> list[tuple[datetime, datetime, timedelta]]:
    if not stamps:
        return []
    blocks: list[tuple[datetime, datetime, timedelta]] = []
    start = stamps[0]
    prev = stamps[0]
    credited = timedelta(0)
    for ts in stamps[1:]:
        gap = ts - prev
        if gap > GAP_END_BLOCK:
            active = credited + TAIL
            blocks.append((start, prev, active))
            start = ts
            credited = timedelta(0)
        else:
            credited += min(gap, GAP_CREDIT_CAP)
        prev = ts
    blocks.append((start, prev, credited + TAIL))
    return blocks


def hours(td: timedelta) -> float:
    return round(td.total_seconds() / 3600.0, 1)


def default_matches(project_root: Path) -> list[str]:
    name = project_root.name
    return [
        name.replace(" ", "-"),
        name.replace(" ", "_"),
        name.replace("_", "-"),
    ]


def find_transcript_dirs(matches: list[str]) -> list[Path]:
    base = Path.home() / ".cursor" / "projects"
    if not base.is_dir():
        return []
    hits: list[Path] = []
    needles = [m.lower() for m in matches if m]
    for child in base.iterdir():
        if not child.is_dir():
            continue
        lowered = child.name.lower()
        if any(n.lower() in lowered for n in needles):
            tdir = child / "agent-transcripts"
            if tdir.is_dir():
                hits.append(tdir)
    return hits


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Project root",
    )
    parser.add_argument(
        "--match",
        action="append",
        default=[],
        help="Substring of ~/.cursor/projects/<id> to include (repeatable)",
    )
    args = parser.parse_args()
    root = Path(args.root).resolve()
    matches = args.match or default_matches(root)
    dirs = find_transcript_dirs(matches)
    stamps = collect_timestamps(dirs)
    blocks = blocks_from(stamps)
    by_day: dict[str, timedelta] = {}
    for start, _end, active in blocks:
        day = start.astimezone().strftime("%Y-%m-%d")
        by_day[day] = by_day.get(day, timedelta(0)) + active
    total = sum(by_day.values(), timedelta(0))
    cursor_h = hours(total)
    trad_h = round(cursor_h * CURSOR_TO_TRADITIONAL, 1)

    print(f"HOURS_CURSOR: {cursor_h}")
    print(f"HOURS_TRADITIONAL: {trad_h}")
    print(f"HOURS_MATCH: {', '.join(matches)}")
    print(f"HOURS_TRANSCRIPT_DIRS: {len(dirs)}")
    print("HOURS_DAY_TABLE:")
    print("| Date | Cursor h | ≡ prog. (×5) | Notes |")
    print("|---|---|---|---|")
    for day in sorted(by_day):
        ch = hours(by_day[day])
        print(f"| {day} | ~{ch} h | ~{round(ch * CURSOR_TO_TRADITIONAL, 1)} h | |")
    print(f"| **Total** | **~{cursor_h} h** | **~{trad_h} h** | |")
    print("HOURS_BLOCKS:")
    print("| Date | Start–end (local) | Active h |")
    print("|---|---|---|")
    for start, end, active in blocks:
        local_s = start.astimezone()
        local_e = end.astimezone()
        print(
            f"| {local_s.strftime('%Y-%m-%d')} | "
            f"{local_s.strftime('%H:%M')}–{local_e.strftime('%H:%M')} | "
            f"{hours(active)} |"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
