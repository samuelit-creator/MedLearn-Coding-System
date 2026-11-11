import os
import django
from django.db import connection

def check_computed():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT name, is_computed, definition
            FROM sys.computed_columns
            WHERE object_id = OBJECT_ID('codings')
        """)
        cols = cursor.fetchall()
        print("--- Computed Columns in 'codings' ---")
        for col in cols:
            print(f"Name: {col[0]}, Is Computed: {col[1]}, Definition: {col[2]}")

if __name__ == "__main__":
    check_computed()
