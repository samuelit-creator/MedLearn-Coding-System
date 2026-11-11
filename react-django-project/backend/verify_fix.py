import os
import django
from django.db import connection

def verify_fix():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # Check for any user who has been allocated the same PDF path more than once
        # (Excluding the ones that already violated it if any, but focus on current state)
        cursor.execute("""
            SELECT user_id, pdf_path, COUNT(*)
            FROM codings
            GROUP BY user_id, pdf_path
            HAVING COUNT(*) > 1
        """)
        dupes = cursor.fetchall()
        if dupes:
            print("WARNING: Duplicate allocations found!")
            for d in dupes:
                print(f"User: {d[0]}, Path: {d[1]}, Count: {d[2]}")
        else:
            print("SUCCESS: No duplicate allocations found in 'codings' table.")

if __name__ == "__main__":
    verify_fix()
