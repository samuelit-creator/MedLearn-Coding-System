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
        print("--- Audit Allocations Sample ---")
        cursor.execute("SELECT TOP 5 end_time FROM audit_allocations WHERE end_time IS NOT NULL")
        for row in cursor.fetchall():
            print(f"Type: {type(row[0])}, Value: {repr(row[0])}")

if __name__ == "__main__":
    probe()
