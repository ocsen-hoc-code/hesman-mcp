"""Data models."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    name: str
    age: int
    email: Optional[str] = None

    def is_adult(self) -> bool:
        return self.age >= 18


class AdminUser(User):
    """Admin user with extra permissions."""

    def __init__(self, name: str, age: int, permissions: list = None):
        super().__init__(name, age)
        self.permissions = permissions or []
