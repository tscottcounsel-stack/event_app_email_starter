import sys, os, traceback
print("PY:", sys.version)
print("EXE:", sys.executable)
try:
    import sqlalchemy, alembic, psycopg2
    print("SQLAlchemy:", sqlalchemy.__version__, "->", getattr(sqlalchemy, "__file__", "?"))
    print("Alembic  :", alembic.__version__, "->", getattr(alembic, "__file__", "?"))
    print("psycopg2 :", psycopg2.__version__, "->", getattr(psycopg2, "__file__", "?"))
except Exception as e:
    print("IMPORT ERROR:", e)
    traceback.print_exc()
