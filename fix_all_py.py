import io
import pathlib
import re
import sys

root = pathlib.Path(".").resolve()


def norm(s: str) -> str:
    s = s.lstrip("\ufeff")  # strip BOM
    s = s.replace("\t", "    ")  # tabs -> 4 spaces
    s = s.replace("\u00A0", " ")  # NBSP -> space
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+\n", "\n", s)  # trim trailing spaces
    return s


changed = 0
for p in root.rglob("*.py"):
    try:
        raw = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    n = norm(raw)
    if n != raw:
        with io.open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(n)
        changed += 1

print(f"Normalized {changed} file(s).")

fails = []
for p in root.rglob("*.py"):
    try:
        compile(p.read_text(encoding="utf-8"), str(p), "exec")
    except SyntaxError as e:
        fails.append(f"{p}: {e.msg} (line {e.lineno}, col {e.offset})")

if fails:
    print("Compilation failures:")
    for m in fails:
        print(" -", m)
    sys.exit(1)
else:
    print("All .py files compile OK.")
