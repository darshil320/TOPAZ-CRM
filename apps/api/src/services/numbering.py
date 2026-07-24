"""Document numbering — fiscal-year aware, collision-free.

Format: <SERIES>-<FY>-<NNNN>, e.g. QTN-2627-0001 (FY 2026-27).
The atomic increment happens in the SQL allocate_number() function (0012); this
module computes the Indian fiscal year (Apr–Mar) and formats the string. Fiscal
year is computed here, never in SQL (PLAN.md decision 5).
"""

from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def fiscal_year(on: date | None = None) -> str:
    """Indian fiscal year label for a date. FY starts 1 April.
    e.g. 2026-05-01 → '2627' (FY 2026-27); 2026-02-01 → '2526' (FY 2025-26)."""
    on = on or date.today()
    start = on.year if on.month >= 4 else on.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"


def format_number(series: str, fy: str, n: int) -> str:
    return f"{series}-{fy}-{n:04d}"


async def allocate(session: AsyncSession, series: str, *, on: date | None = None) -> str:
    """Allocate the next document number for a series in the current fiscal year.
    Caller commits the surrounding transaction."""
    fy = fiscal_year(on)
    result = await session.execute(
        text("SELECT allocate_number(:series, :fy)"),
        {"series": series, "fy": fy},
    )
    return format_number(series, fy, result.scalar_one())
