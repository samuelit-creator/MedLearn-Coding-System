import os
import django
from django.db import connection

def check_schema():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("Columns in dx_entries:")
        cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'dx_entries'")
        for row in cursor.fetchall():
            print(f" - {row[0]} ({row[1]})")

if __name__ == "__main__":
    try:
        check_schema()
    except Exception as e:
        print(f"Error: {e}")
