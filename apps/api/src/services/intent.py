"""Pure intent-trigger classifier for inbound customer messages (M5).

Detects high-value intents in a WhatsApp reply so the assigned salesperson can be
alerted immediately: a request to be called, an intent to visit, confusion (needs
a human), or a buying signal. Bilingual — English + common Hindi/Hinglish phrasing,
since the showroom's customers mix languages.

Pure and I/O-free by design (repo discipline): the Celery inbound handler calls
`detect_intents(text)` and acts on the result. Patterns are compiled once at import.
No LLM call — deterministic, cheap, unit-testable, and it never blocks the reply path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Alert type identifiers — must match the `alerts.type` CHECK constraint (0010).
INTENT_CALL = "intent_call"
INTENT_VISIT = "intent_visit"
CONFUSION = "confusion"
BUYING_SIGNAL = "buying_signal"

# Human-facing label per type, used in the salesperson WhatsApp alert.
INTENT_LABELS: dict[str, str] = {
    INTENT_CALL: "wants a call back",
    INTENT_VISIT: "plans to visit",
    CONFUSION: "seems confused — needs help",
    BUYING_SIGNAL: "showing a buying signal",
}

# Ordered most- to least-urgent for display/dedup stability.
INTENT_PRIORITY: list[str] = [INTENT_CALL, INTENT_VISIT, BUYING_SIGNAL, CONFUSION]

# Each pattern is matched case-insensitively against the raw message. Phrases use
# loose boundaries (\b where a word, plain substring where a fragment like "aa").
# Kept as source strings and compiled once below.
_PATTERNS: dict[str, list[str]] = {
    INTENT_CALL: [
        r"\bcall me\b", r"\bcall back\b", r"\bcall ?back\b", r"\bcallback\b",
        r"\bgive me a call\b", r"\bring me\b", r"\bphone me\b", r"\bcall kar",
        r"\bphone kar", r"\bmujhe call\b", r"\bbaat kar",
    ],
    INTENT_VISIT: [
        r"\bvisit\b", r"\bcome (?:to|by|over)\b", r"\bcome in\b",
        r"\bwhen can i come\b", r"\bi'?ll come\b", r"\bi will come\b",
        r"\bdrop by\b", r"\bshowroom aa", r"\baana hai\b", r"\baana chah",
        r"\baaunga\b", r"\baaung", r"\bdekhne aa",
    ],
    BUYING_SIGNAL: [
        r"\bbuy\b", r"\bpurchase\b", r"\border\b", r"\bbook (?:it|this|now)\b",
        r"\bprice\b", r"\bquote\b", r"\bhow much\b", r"\bcost\b", r"\bemi\b",
        r"\bdiscount\b", r"\bfinali[sz]e\b", r"\bready to (?:buy|order|book)\b",
        r"\bkitna\b", r"\bkitne\b", r"\bkharid", r"\blena hai\b", r"\ble lung",
    ],
    CONFUSION: [
        r"\bconfus", r"\bdon'?t understand\b", r"\bnot clear\b",
        r"\bwhat do you mean\b", r"\bwhat does (?:this|that) mean\b",
        r"\bcan you explain\b", r"\bsamajh nahi\b", r"\bsamjha nahi\b",
        r"\bsamajh nhi\b", r"\bkya matlab\b", r"\bmatlab kya\b", r"\bnahi samjha\b",
    ],
}

_COMPILED: dict[str, list[re.Pattern[str]]] = {
    intent: [re.compile(p, re.IGNORECASE) for p in patterns]
    for intent, patterns in _PATTERNS.items()
}


@dataclass(frozen=True)
class IntentHit:
    """A single detected intent and the phrase that matched it."""

    type: str
    matched: str


def detect_intents(text: str | None) -> list[IntentHit]:
    """Return the intents present in `text`, at most one per type, priority-ordered.

    Empty/whitespace input yields no hits. The first matching pattern per intent
    wins (its match becomes `matched`), so callers get a short, human-readable
    snippet without scanning the message themselves.
    """
    if not text or not text.strip():
        return []

    hits: list[IntentHit] = []
    for intent in INTENT_PRIORITY:
        for pattern in _COMPILED[intent]:
            m = pattern.search(text)
            if m:
                hits.append(IntentHit(type=intent, matched=m.group(0).strip()))
                break  # one hit per intent
    return hits
