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

        # asyncpg PREPARES every statement it is handed, and a prepared statement may
        # hold exactly one command — so a multi-statement migration file cannot go
        # through session.execute(). The raw connection's execute() runs a script
        # instead, which is the only path that accepts a whole file.
        raw = await session.connection()
        driver_conn = (await raw.get_raw_connection()).driver_connection

        # BEGIN/COMMIT are written into the script itself rather than relying on the
        # session's transaction: driver_conn.execute() bypasses SQLAlchemy's unit of
        # work, so without this the ledger insert could commit while the schema change
        # had failed — recording a migration that never ran.
        await driver_conn.execute(
            "BEGIN;\n"
            + sql
            + "\nINSERT INTO supabase_migrations.schema_migrations (version, name)"
            f" VALUES ('{version}', '{name}') ON CONFLICT (version) DO NOTHING;"
            "\nCOMMIT;"
        )
        print(f"applied {version}_{name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/apply_migration.py <path-to-migration.sql>")
    asyncio.run(main(sys.argv[1]))
