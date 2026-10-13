"""Inventory helpers used by the language conformance suite."""

from dataclasses import dataclass

MAX_ITEMS = 100
_DEFAULT_COUNT = 1
LOW_STOCK, HIGH_STOCK = 5, 50


def _clamp(value, low, high):
    """Clamp value into the range [low, high]."""
    return max(low, min(value, high))


@dataclass
class Item:
    """One stock item."""

    name: str
    count: int = _DEFAULT_COUNT

    def total_weight(self, unit_weight):
        """Weight of every unit in stock."""
        return self.count * unit_weight

    def _is_low(self):
        return self.count < LOW_STOCK


class Perishable(Item):
    """An item that expires."""

    def __init__(self, name, days_left):
        super().__init__(name)
        self.days_left = days_left

    def is_expired(self):
        """True once no days are left."""
        return self.days_left <= 0


# Adds stock to an item without exceeding the cap.
def restock(item, amount):
    def _apply(current):
        """New count after adding the amount."""
        return _clamp(current + amount, 0, MAX_ITEMS)

    item.count = _apply(item.count)
    return item


async def restock_all(items, amount):
    """Restock every item by the same amount."""
    return [restock(item, amount) for item in items]
