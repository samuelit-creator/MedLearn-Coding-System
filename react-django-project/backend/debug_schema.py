
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

def check_table(table_name, f):
    f.write(f"\n--- Table: {table_name} ---\n")
    with connection.cursor() as cursor:
        try:
            cursor.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table_name}'")
            columns = cursor.fetchall()
            if not columns:
                f.write(f"Table '{table_name}' not found or no columns.\n")
            else:
                for col in columns:
                    f.write(f"{col}\n")
        except Exception as e:
            f.write(f"Error checking {table_name}: {e}\n")

with open('schema_debug.txt', 'w') as f:
    tables = ['codings', 'audit_allocations', 'audit_errors', 'audit_dx_entries', 'user_details', 'dx_entries']
    for t in tables:
        check_table(t, f)
