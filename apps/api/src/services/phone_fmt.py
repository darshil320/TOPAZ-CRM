"""Human-readable phone numbers for message bodies. Pure, no I/O.

The DB stores E.164-ish digits (`salespersons.whatsapp` is what the Cloud API needs:
`916356320206`). A customer reading "Your advisor Ramesh (916356320206) will assist you"
has to parse it themselves, and on most Android keyboards that string is not tappable as
a dial link either. So the send path renders through here.

Deliberately CONSERVATIVE: anything that is not recognisably an Indian mobile comes back
trimmed but otherwise untouched. Guessing a grouping for an unknown format would put a
mangled number in front of a customer, which is worse than an unformatted one.
"""

_INDIA_CC = "91"
_MOBILE_DIGITS = 10


def digits_only(raw: str | None) -> str:
    """Every digit in `raw`, in order. Drops '+', spaces, dashes, brackets."""
    if not raw:
        return ""
    return "".join(ch for ch in raw if ch.isdigit())


def to_e164_india(raw: str | None) -> str:
    """`+91XXXXXXXXXX` when `raw` is an Indian mobile; '' when it is not usable.

    Used for the `tel:` / wa.me forms, where grouping spaces are not allowed.
    """
    digits = digits_only(raw)
    if len(digits) == _MOBILE_DIGITS:
        return f"+{_INDIA_CC}{digits}"
    if len(digits) == len(_INDIA_CC) + _MOBILE_DIGITS and digits.startswith(_INDIA_CC):
        return f"+{digits}"
    return ""


def display(raw: str | None) -> str:
    """`+91 63563 20206` for an Indian mobile; the trimmed input for anything else."""
    e164 = to_e164_india(raw)
    if not e164:
        return (raw or "").strip()
    national = e164[len("+") + len(_INDIA_CC):]
    return f"+{_INDIA_CC} {national[:5]} {national[5:]}"
