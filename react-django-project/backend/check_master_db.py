import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        # Switch to master database
        cursor.execute("USE master")
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_name LIKE '%Leave%'")
        tables = cursor.fetchall()
        print("--- Leave Tables in MASTER DB ---")
        for t in tables:
            print(t[0])
        print("---------------------------------")
        
        if tables:
            cursor.execute("SELECT TOP 5 * FROM LeaveRequests")
            print("Found data in master.LeaveRequests!")
    except Exception as e:
        print(f"Error checking master DB: {e}")
