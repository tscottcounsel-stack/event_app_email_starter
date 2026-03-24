# tests/test_ci_smoke.py
import importlib


def test_app_imports():
    # Adjust module names to your project structure
    # Try these in order; the ones that exist will import
    for mod in ("app", "main", "src.app"):
        try:
            importlib.import_module(mod)
            return
        except ModuleNotFoundError:
            continue
    raise AssertionError("Could not import app/main module")


def test_truth():
    assert True
