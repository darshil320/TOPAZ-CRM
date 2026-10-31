"""The role groups exist three times — SQL helpers (0052), apps/api roles.py, and the
dashboard's lib/roles.ts. They must agree, or the database, the API and the UI disagree
on who may do what. Parses the source; no DB needed."""
import re
from pathlib import Path

from src.services import roles

REPO = Path(__file__).resolve().parents[3]
SQL = (REPO / "supabase/migrations/0052_super_admin_front_desk.sql").read_text()
SQL_0053 = (REPO / "supabase/migrations/0053_product_qr_stock.sql").read_text()
TS = (REPO / "apps/dashboard/src/lib/roles.ts").read_text()


def _sql_roles(function: str, sql: str = SQL) -> set[str]:
    body = re.search(rf"create or replace function {function}\(\).*?\$\$;", sql, re.S).group(0)
    return set(re.findall(r"'([a-z_]+)'", re.search(r"role in \(([^)]*)\)", body).group(1)))


def _ts_list(name: str) -> list[str]:
    return re.findall(r'"([a-z_]+)"', re.search(rf"const {name}[^=]*= \[([^\]]*)\]", TS).group(1))


def _ts_roles(name: str) -> set[str]:
    spread = re.search(rf"const {name}[^=]*= \[\.\.\.([A-Z_]+)", TS)
    own = set(_ts_list(name))
    return own | (_ts_roles(spread.group(1)) if spread else set())


def test_sql_helpers_match_roles_py():
    assert _sql_roles("is_owner") == roles.OWNER_LEVEL
    assert _sql_roles("can_view_all") == roles.VIEW_ALL
    assert _sql_roles("is_dispatcher") == roles.DISPATCH


def test_dashboard_roles_match_roles_py():
    assert _ts_roles("OWNER_LEVEL") == roles.OWNER_LEVEL
    assert _ts_roles("VIEW_ALL") == roles.VIEW_ALL
    assert _ts_roles("DISPATCH") == roles.DISPATCH
    assert _ts_roles("NO_REMOVAL") == roles.NO_REMOVAL


def test_product_helpers_match_roles_py():
    assert _sql_roles("can_view_prices", SQL_0053) == roles.PRICE_VIEW
    assert _sql_roles("can_view_stock", SQL_0053) == roles.STOCK_VIEW


def test_dashboard_product_roles_match_roles_py():
    assert _ts_roles("PRICE_VIEW") == roles.PRICE_VIEW
    assert _ts_roles("STOCK_VIEW") == roles.STOCK_VIEW
    assert _ts_roles("PRODUCT_MANAGE") == roles.PRODUCT_MANAGE
