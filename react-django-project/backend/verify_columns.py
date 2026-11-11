import django
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from django.db import connection

def get_cols(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT TOP 0 * FROM [{table}]')
        return [col[0].lower() for col in cursor.description]

checks = {
    'audit_allocations': ['chart_id', 'auditor_id', 'chart_status', 'allocated_at', 'project', 'subproject'],
    'at_audit_allocations': ['chart_id', 'auditor_id', 'chart_status', 'allocated_at', 'project', 'subproject'],
    'codings': ['chart_id', 'project_pdf_id', 'project', 'subproject', 'user_id'],
    'audit_dx_entries': ['chart_id', 'from_date', 'dxcode'],
    'at_audit_dx_entries': ['chart_id', 'from_date', 'dxcode'],
    'audit_errors': ['chart_id', 'error_type', 'error_count'],
    'at_audit_errors': ['chart_id', 'error_type', 'error_count']
}

print('--- Column Verification ---')
for table, required in checks.items():
    try:
        actual = get_cols(table)
        missing = [c for c in required if c not in actual]
        if missing:
            print(f'{table}: MISSING {missing}')
        else:
            print(f'{table}: ALL OK')
    except Exception as e:
        print(f'{table}: ERROR {e}')
