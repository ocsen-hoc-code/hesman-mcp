import json


def load_config(path: str) -> dict:
    """Read settings from a JSON file on disk."""
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)
