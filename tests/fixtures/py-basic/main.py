"""Main module for Hesman test fixture."""

def add(a: int, b: int) -> int:
    """Add two integers and return the sum."""
    return a + b


def subtract(a: int, b: int) -> int:
    return a - b


class Calculator:
    """A simple calculator class."""

    def __init__(self, initial: int = 0):
        self.value = initial

    def add(self, n: int) -> int:
        self.value = add(self.value, n)
        return self.value

    def get_value(self) -> int:
        return self.value
