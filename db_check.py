# db_check.py
import argparse
import glob
import os
import sqlite3

DB_PATH = "test.db"
CSV_DIR = "csv_output"


def cleanup():
    # Remove DB file if exists
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"✅ Removed {DB_PATH}")

    # Auto-prune CSVs, keep only latest
    if os.path.exists(CSV_DIR):
        csv_files = sorted(
            glob.glob(os.path.join(CSV_DIR, "*.csv")),
            key=os.path.getmtime,
            reverse=True,
        )
        if csv_files:
            keep = csv_files[0]
            for f in csv_files[1:]:
                os.remove(f)
                print(f"🧹 Removed old CSV: {f}")
            print(f"✅ Kept latest CSV: {keep}")
        else:
            print("⚠️ No CSV files found to prune.")


def check_db():
    if not os.path.exists(DB_PATH):
        print("⚠️ Database not found. Creating new one...")
        conn = sqlite3.connect(DB_PATH)
        conn.close()
        print(f"✅ Created {DB_PATH}")
    else:
        print(f"✅ DB already exists: {DB_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Clean DB + prune CSVs before/after tests",
    )
    args = parser.parse_args()

    if args.cleanup:
        cleanup()
    else:
        check_db()
