import os
import sys
import django
from django.db import connection

# Setup Django environment
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

def probe():
    with connection.cursor() as cursor:
        print("--- Codings (user_id count) ---")
        cursor.execute("SELECT user_id, COUNT(*) FROM codings GROUP BY user_id")
        for row in cursor.fetchall():
            print(row)

        print("\n--- Codings (Dates) ---")
        cursor.execute("SELECT MIN(created_at), MAX(created_at) FROM codings")
        print(cursor.fetchone())

if __name__ == "__main__":
    probe()
