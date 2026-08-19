"""Apply ONE migration file and record it in the Supabase migration ledger.

Why this exists rather than `supabase db push`: push applies EVERY unapplied file in
supabase/migrations/, and this repo's migration head routinely runs ahead of prod (see
supabase/migrations_pending/README.md). When prod is several versions behind, a push is
an unreviewed batch of schema changes — including, right now, the multi-order-delivery
rollout whose companions are deliberately quarantined. This applies exactly the file you
name, and nothing else.

    python scripts/apply_migration.py ../../supabase/migrations/0046_leads.sql

The whole file runs in ONE transaction: a migration that fails halfway leaves the schema
in a state no version number describes, which is worse than not having run it at all.
The ledger insert is part of that same transaction, so a rolled-back migration is never
recorded as applied.
"""

import asyncio
import re
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database import get_api_session  # noqa: E402


def parse_version(path: Path) -> tuple[str, str]:
    """'0046_leads.sql' -> ('0046', 'leads'). The ledger keys on the version."""
    match = re.match(r"^(\d+)_(.+)\.sql$", path.name)
    if not match:
        raise SystemExit(f"filename must look like 0046_name.sql, got {path.name!r}")
    return match.group(1), match.group(2)


async def main(raw_path: str) -> None:
    path = Path(raw_path).resolve()
    if not path.is_file():
        raise SystemExit(f"no such file: {path}")

    version, name = parse_version(path)
    sql = path.read_text()

    async with get_api_session() as session:
        applied = await session.execute(
            text("SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = :v"),
            {"v": version},
        )
        if applied.first() is not None:
            print(f"{version} already recorded as applied — nothing to do")
            return

        await session.execute(text(sql))
        await session.execute(
            text(
                "INSERT INTO supabase_migrations.schema_migrations (version, name)"
                " VALUES (:v, :n) ON CONFLICT (version) DO NOTHING"
            ),
            {"v": version, "n": name},
        )
        await session.commit()
        print(f"applied {version}_{name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/apply_migration.py <path-to-migration.sql>")
    asyncio.run(main(sys.argv[1]))
