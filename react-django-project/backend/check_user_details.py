import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_details' ORDER BY ordinal_position")
        columns = cursor.fetchall()
        print("--- user_details Columns ---")
        for col in columns:
            print(f"{col[0]}: {col[1]}")
    except Exception as e:
        print(f"Error querying user_details: {e}")

    # Check for stored procedures containing 'Leave'
    try:
        cursor.execute("SELECT name FROM sys.objects WHERE type = 'P' AND name LIKE '%Leave%'")
        procs = cursor.fetchall()
        print("\nProcedures containing 'Leave':")
        for p in procs:
            print(p[0])
    except Exception as e:
        print(f"Error querying procs: {e}")
