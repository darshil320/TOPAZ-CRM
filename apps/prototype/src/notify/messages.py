"""Owner-alert copy. Mirrors PRD §13.4 examples.

Pure string builders — unit-tested, no dependencies. In production these become the
pre-approved WhatsApp utility templates (`new_customer_alert`, `repeat_customer_alert`).
"""

from __future__ import annotations


def new_customer_message(when: str, showroom: str = "Topaz") -> str:
    """Alert for an unrecognised (new) visitor. Photo is attached separately."""
    return (
        f"\U0001f514 New customer visited at {showroom}\n"
        f"\U0001f4f8 Photo attached\n"
        f"\U0001f551 {when}"
    )


def repeat_customer_message(
    name: str,
    interest: str,
    when: str,
    salesperson: str | None = None,
) -> str:
    """Alert for a recognised (repeat) visitor — name + last interest + handler.

    Matches PRD example: "Repeat customer visited - Sofa + Dining interest - handled by Rahul".
    """
    lines = [
        f"\U0001f514 Repeat customer visited — {name}",
        f"\U0001f6cb️ Last interested in: {interest}",
    ]
    if salesperson:
        lines.append(f"\U0001f464 Handled by: {salesperson}")
    lines.append(f"\U0001f551 {when}")
    return "\n".join(lines)
