import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT TOP 5 * FROM LeaveRequests")
        rows = cursor.fetchall()
        print("--- LeaveRequests Sample Data ---")
        for row in rows:
            print(row)
        
        # Get columns
        cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'LeaveRequests' ORDER BY ordinal_position")
        columns = cursor.fetchall()
        print("\nColumns:")
        for col in columns:
            print(f"{col[0]}: {col[1]}")
    except Exception as e:
        print(f"Error querying LeaveRequests: {e}")

    # Also check sys.tables just in case information_schema is restricted
    try:
        cursor.execute("SELECT name FROM sys.tables WHERE name LIKE '%Leave%'")
        tables = cursor.fetchall()
        print("\nTables from sys.tables containing 'Leave':")
        for t in tables:
            print(t[0])
    except Exception as e:
        print(f"Error querying sys.tables: {e}")
