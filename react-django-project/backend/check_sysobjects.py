import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT * FROM sys.sysobjects WHERE name = 'LeaveRequests'")
        row = cursor.fetchone()
        if row:
            print(f"Found LeaveRequests in sysobjects: {row}")
        else:
            print("LeaveRequests NOT found in sysobjects.")
    except Exception as e:
        print(f"Error querying sysobjects: {e}")
