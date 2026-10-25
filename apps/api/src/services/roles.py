"""Staff role groups — the one place each "who counts as …" decision lives (0052).

Pure constants, no I/O. Mirrors the SQL helpers of migration 0052 so the API (which
runs on the service-role connection, where RLS does not apply) and the database agree:

    OWNER_LEVEL ⇔ is_owner()       owner, super_admin
    VIEW_ALL    ⇔ can_view_all()   + admin: sees and edits everything, removes nothing
    DISPATCH    ⇔ is_dispatcher()  + front_desk: attaches walk-ins, quotes on behalf
"""

OWNER_LEVEL = frozenset({"owner", "super_admin"})
VIEW_ALL = OWNER_LEVEL | {"admin"}
DISPATCH = VIEW_ALL | {"front_desk"}

# May never remove anything — delete, deactivate, retire, cancel.
NO_REMOVAL = frozenset({"admin"})

# Who a walk-in can be assigned to, and who a quotation can be prepared for.
SELLING = frozenset({"salesperson"})

# Never see photos of a customer (their home, their site) — mirrors 0052's media_select.
CUSTOMER_MEDIA_HIDDEN = frozenset({"workshop_manager", "delivery", "front_desk"})

# Preferred first when an alert has to fall back to "the owner": the business owner,
# then a super_admin when no owner account exists.
OWNER_FALLBACK_ORDER_SQL = (
    "role IN ('owner', 'super_admin') AND active = true"
    " ORDER BY (role = 'owner') DESC, created_at ASC"
)
