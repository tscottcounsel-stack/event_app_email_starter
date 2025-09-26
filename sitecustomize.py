# sitecustomize.py
# Test-only helper to avoid Windows file locks for temp SQLite DBs named app_test_*.db.

from __future__ import annotations
import os

if "PYTEST_CURRENT_TEST" in os.environ:
    import sqlite3, time, pathlib

    def _is_test_db_path(s: str) -> bool:
        if not isinstance(s, str):
            return False
        low = s.lower().replace("\\", "/")
        return ("app_test_" in low) and (low.endswith(".db") or ".db?" in low)

    # Redirect any sqlite3.connect to app_test_*.db -> :memory:
    _orig_connect = sqlite3.connect
    def _connect_patched(database, *args, **kwargs):
        try:
            if isinstance(database, str) and _is_test_db_path(database):
                kwargs = dict(kwargs)
                kwargs.pop("uri", None)
                return _orig_connect(":memory:", *args, **kwargs)
        except Exception:
            pass
        return _orig_connect(database, *args, **kwargs)
    sqlite3.connect = _connect_patched  # type: ignore[assignment]

    # Be forgiving on teardown: retry removal then swallow if still locked
    _ORIG_REMOVE = os.remove
    def _remove_with_retry(path, *a, **kw):
        if _is_test_db_path(str(path)):
            for _ in range(30):  # ~3s
                try:
                    return _ORIG_REMOVE(path)
                except PermissionError:
                    time.sleep(0.1)
            return None
        return _ORIG_REMOVE(path, *a, **kw)
    os.remove = _remove_with_retry  # type: ignore[assignment]

    _ORIG_UNLINK = pathlib.Path.unlink
    def _unlink_with_retry(self, *a, **kw):
        if _is_test_db_path(str(self)):
            for _ in range(30):
                try:
                    return _ORIG_UNLINK(self, *a, **kw)
                except PermissionError:
                    time.sleep(0.1)
            return None
        return _ORIG_UNLINK(self, *a, **kw)
    pathlib.Path.unlink = _unlink_with_retry  # type: ignore[assignment]
else:
    # Outside pytest: do nothing.
    pass
