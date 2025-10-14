# conftest.py (project root)
# Best-effort cleanup for Windows temp SQLite test DBs; never fail on teardown.

from __future__ import annotations

import os
import pathlib
import time

import pytest  # noqa: F401  (ensure pytest loads this file)


def _is_app_test_db(path: str) -> bool:
    return (
        isinstance(path, str) and "app_test_" in path and path.lower().endswith(".db")
    )


# Patch os.remove: retry ~3s, then swallow PermissionError for app_test_*.db
_ORIG_REMOVE = os.remove


def _remove_with_retry(path, *args, **kwargs):
    if _is_app_test_db(str(path)):
        for _ in range(30):
            try:
                return _ORIG_REMOVE(path)
            except PermissionError:
                time.sleep(0.1)
        return None  # swallow if still locked
    return _ORIG_REMOVE(path, *args, **kwargs)


os.remove = _remove_with_retry  # type: ignore[assignment]

# Patch Path.unlink similarly
_ORIG_UNLINK = pathlib.Path.unlink


def _unlink_with_retry(self, *args, **kwargs):
    if _is_app_test_db(str(self)):
        for _ in range(30):
            try:
                return _ORIG_UNLINK(self, *args, **kwargs)
            except PermissionError:
                time.sleep(0.1)
        return None
    return _ORIG_UNLINK(self, *args, **kwargs)


pathlib.Path.unlink = _unlink_with_retry  # type: ignore[assignment]
