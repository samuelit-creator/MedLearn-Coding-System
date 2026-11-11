import os
import django
import json
from django.db import connection

def check_audit_logs(chart_id):
    results = {}
    with connection.cursor() as cursor:
        # Check audit_errors
        cursor.execute("SELECT id, row_id, error_type, error_count, error_command, created_at FROM audit_errors WHERE chart_id = %s", [chart_id])
        cols = [c[0] for c in cursor.description]
        results['audit_errors'] = [dict(zip(cols, r)) for r in cursor.fetchall()]

        # Check at_audit_errors
        cursor.execute("SELECT id, row_id, error_type, error_count, error_command, created_at FROM at_audit_errors WHERE chart_id = %s", [chart_id])
        cols = [c[0] for c in cursor.description]
        results['at_audit_errors'] = [dict(zip(cols, r)) for r in cursor.fetchall()]

        # Check at_audit_allocations (to see which API is hit)
        cursor.execute("SELECT 1 FROM at_audit_allocations WHERE chart_id = %s", [chart_id])
        results['is_at_audit'] = cursor.fetchone() is not None

    return results

if __name__ == "__main__":
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    chart_info = check_audit_logs('29169809')
    print(json.dumps(chart_info, indent=4, default=str))
