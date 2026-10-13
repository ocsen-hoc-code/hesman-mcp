def py_format_name(name: str) -> str:
    return name.strip()


def py_greet(name: str) -> str:
    return f"Hello, {py_format_name(name)}!"
