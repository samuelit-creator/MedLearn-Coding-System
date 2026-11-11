from django.db import connection
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

def check_schema():
    with connection.cursor() as c:
        c.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'manual_icd'")
        columns = c.fetchall()
        print(f"Columns: {columns}")

if __name__ == "__main__":
    check_schema()
