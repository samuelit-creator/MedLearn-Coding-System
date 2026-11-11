import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT * FROM user_details WHERE user_employee_id = 'MLV1464'")
        row = cursor.fetchone()
        if row:
            print(f"Found MLV1464: {row}")
        else:
            print("MLV1464 NOT found in user_details.")
            
        # Also check first 5 users
        cursor.execute("SELECT TOP 5 user_employee_id, username FROM user_details")
        rows = cursor.fetchall()
        print("\nFirst 5 users:")
        for r in rows:
            print(r)
    except Exception as e:
        print(f"Error querying user_details: {e}")
