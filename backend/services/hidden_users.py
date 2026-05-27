"""Hidden users utility.

Provides a central list of user emails that must be completely hidden
from the site (user lists, roles and permissions, sharing, statistics, etc.).

Keep emails lowercased here; comparisons are case-insensitive.
"""
from __future__ import annotations

from typing import Iterable, Optional

# Emails (lowercased) that should be hidden from all public/admin user lists.
HIDDEN_USER_EMAILS: set[str] = {
    "faisal.f.s.b.kw@gmail.com",
}


def is_hidden_email(email: Optional[str]) -> bool:
    """Return True if the given email is in the hidden list (case-insensitive)."""
    if not email:
        return False
    return email.strip().lower() in HIDDEN_USER_EMAILS


def filter_hidden_users(users: Iterable) -> list:
    """Filter out users whose email is in the hidden list.

    Works with ORM User objects that expose an ``email`` attribute.
    """
    return [u for u in users if not is_hidden_email(getattr(u, "email", None))]


def get_hidden_emails_lower() -> set[str]:
    """Return a copy of the hidden email set (already lowercased)."""
    return set(HIDDEN_USER_EMAILS)