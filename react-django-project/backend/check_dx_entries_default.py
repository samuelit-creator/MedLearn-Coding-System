import os
import django
from django.db import connection

def check_default():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("Default value for created_at in dx_entries:")
        cursor.execute("""
            SELECT COLUMN_DEFAULT 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'dx_entries' AND COLUMN_NAME = 'created_at'
        """)
        row = cursor.fetchone()
        if row:
            print(f"Default: {row[0]}")
        else:
            print("No default found.")

if __name__ == "__main__":
    try:
        check_default()
    except Exception as e:
        print(f"Error: {e}")
