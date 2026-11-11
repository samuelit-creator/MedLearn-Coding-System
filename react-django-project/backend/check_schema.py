import django
import os
import sys

# Setup Django environment
sys.path.append('c:/reactjs/react-django-project/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db import connection

def check_table(table_name):
    res = f"\n--- Schema for {table_name} ---\n"
    with connection.cursor() as cursor:
        try:
            cursor.execute(f"SELECT TOP 0 * FROM [{table_name}]")
            cols = [col[0] for col in cursor.description]
            for col in cols:
                res += f"  - {col}\n"
        except Exception as e:
            res += f"  Error: {e}\n"
    return res

tables = [
    'audit_allocations',
    'audit_dx_entries',
    'audit_errors',
    'at_audit_allocations',
    'at_audit_dx_entries',
    'at_audit_errors',
    'codings',
    'dx_entries'
]

with open('c:/reactjs/react-django-project/backend/schema_output_debug.txt', 'w') as f:
    for t in tables:
        f.write(check_table(t))
