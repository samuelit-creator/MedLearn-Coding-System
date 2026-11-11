import django
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from django.db import connection

def get_cols(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT TOP 0 * FROM [{table}]')
        return [col[0] for col in cursor.description]

tables = [
    'audit_allocations', 
    'at_audit_allocations', 
    'codings', 
    'audit_dx_entries', 
    'at_audit_dx_entries', 
    'audit_errors', 
    'at_audit_errors'
]

with open('schema_output.txt', 'w') as f:
    f.write('--- Table Columns ---\n')
    for t in tables:
        try:
            cols = get_cols(t)
            f.write(f'{t} ({len(cols)}): {", ".join(cols)}\n')
        except Exception as e:
            f.write(f'{t}: ERROR {e}\n')
