import django
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from django.db import connection

def get_cols(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT TOP 0 * FROM [{table}]')
        return [col[0].lower() for col in cursor.description]

tables = ['audit_dx_entries', 'at_audit_dx_entries', 'audit_errors', 'at_audit_errors']
with open('columns_report_2.txt', 'w') as f:
    for t in tables:
        try:
            cols = get_cols(t)
            f.write(f'Table: {t}\n')
            f.write(f'Columns: {", ".join(cols)}\n\n')
        except Exception as e:
            f.write(f'Table: {t} ERROR: {e}\n\n')
