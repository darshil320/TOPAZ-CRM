"""The allocate queue's optional-parameter typing (regression).

`unallocated_items` 500'd for EVERY caller with
`AmbiguousParameterError: could not determine data type of parameter $1`, because a bare
`:sp IS NULL` gives Postgres nothing to infer the parameter's type from at PREPARE time and
it does not carry the type backwards from a `cast(:sp as uuid)` further down the query.

The bug is invisible to a pure unit test — it only appears when a real driver prepares the
statement — so this asserts on the SQL text instead: every use of the optional parameter
must be wrapped in a cast. Cheap, and it fails the moment somebody removes one.
"""

import re

from src.repositories import production_repo


def _sql_of_unallocated() -> str:
    """The query text as written in the source, without needing a database.

    The DOCSTRING IS STRIPPED FIRST — it explains the bug and therefore quotes the very
    broken form (`:sp IS NULL`) these tests search for. Scanning it would make the test
    fail on its own explanation.
    """
    import inspect

    source = inspect.getsource(production_repo.unallocated_items)
    doc = production_repo.unallocated_items.__doc__
    return source.replace(doc, "") if doc else source


def test_every_use_of_the_optional_param_is_cast():
    sql = _sql_of_unallocated()
    uses = re.findall(r"(cast\(\s*:sp\s+as\s+uuid\s*\)|:sp)", sql)
    # Strip the ones that ARE the cast, then require nothing bare is left.
    bare = [u for u in uses if not u.startswith("cast")]
    assert bare == [], (
        f"{len(bare)} bare `:sp` use(s) left in unallocated_items — Postgres cannot infer "
        "the type at prepare time and the allocate page will 500"
    )


def test_the_null_branch_specifically_is_cast():
    """`:sp IS NULL` was the exact form that broke it."""
    sql = _sql_of_unallocated()
    assert ":sp IS NULL" not in sql
    assert "cast(:sp as uuid) IS NULL" in sql


def test_both_call_shapes_are_still_supported():
    """Owner/admin pass nothing; a salesperson passes their id. Both must remain valid."""
    import inspect

    params = inspect.signature(production_repo.unallocated_items).parameters
    assert params["salesperson_id"].default is None
