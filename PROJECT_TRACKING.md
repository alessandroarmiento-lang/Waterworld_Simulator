# Waterworld Simulator 1.0 — costs & hours

## Running totals

| | Amount |
|---|---|
| **Logged work hours (active chat, Cursor)** | **~1.6 h** |
| **Equivalent traditional programmer hours** | **~8.0 h** *(Cursor × 5)* |

## Work hours — how we count

**Count only:** back-and-forth with the assistant + assistant processing/tool runs, from Cursor chat timestamps.

**Do not count:** long AFK, overnight gaps, days with no chat.

**Method** (`python3 deploy/count_work_hours.py`):

1. Collect message timestamps from Cursor agent transcripts for this project.
2. Gap **> 30 minutes** → end of a work block (pause not counted).
3. Inside a block, each gap between timestamps is credited up to **10 minutes** max.
4. Add **~3 minutes** after the last message of a block.
5. **Equivalente programmatore tradizionale (rapporto 1∶5):** `ore_programmatore ≈ ore_Cursor × 5`. Report **both** figures.

Recompute when asked (“aggiorna le ore”) or at end of day.

### By day (active hours)

| Date | Cursor h | ≡ prog. (×5) | Notes |
|---|---|---|---|
| 2026-09-09 | ~1.6 h | ~8.0 h | Globo, città, pan/asse, sync ore |
| **Total** | **~1.6 h** | **~8.0 h** | |

### Session blocks (detail)

| Date | Start–end (local) | Active h |
|---|---|---|
| 2026-09-09 | 02:30–04:03 | 1.6 |
