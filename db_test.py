from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql+psycopg2://postgres:Tazvendor@localhost:5432/eventdb"

engine = create_engine(DATABASE_URL, echo=True)

try:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        print("âœ… Database connection successful:", result.scalar())
except Exception as e:
    print("âŒ Database connection failed:", e)
