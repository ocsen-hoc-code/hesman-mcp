"""Utility functions."""

from typing import List, Optional


def filter_positive(numbers: List[int]) -> List[int]:
    """Return only positive numbers from the list."""
    return [n for n in numbers if n > 0]


def find_max(numbers: List[int]) -> Optional[int]:
    if not numbers:
        return None
    return max(numbers)
