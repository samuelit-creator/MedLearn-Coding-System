import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_schema, table_name")
        tables = cursor.fetchall()
        print("--- ALL TABLES WITH SCHEMAS ---")
        for t in tables:
            print(f"{t[0]}.{t[1]}")
        print("-------------------------------")
    except Exception as e:
        print(f"Error listing tables with schemas: {e}")
