import os
import django
import json
from django.db import connection

def check_chart(chart_id):
    results = {}
    with connection.cursor() as cursor:
        # Check codings
        cursor.execute("SELECT chart_id, chart_status, user_id, project, subproject, date, created_at FROM codings WHERE chart_id = %s", [chart_id])
        cols = [c[0] for c in cursor.description]
        results['codings'] = [dict(zip(cols, r)) for r in cursor.fetchall()]

        # Check audit_allocations
        cursor.execute("SELECT chart_id, chart_status, auditor_id, project, subproject, allocated_at FROM audit_allocations WHERE chart_id = %s", [chart_id])
        cols = [c[0] for c in cursor.description]
        results['audit_allocations'] = [dict(zip(cols, r)) for r in cursor.fetchall()]

        # Check at_audit_allocations
        cursor.execute("SELECT chart_id, chart_status, at_auditor_id, project, subproject, allocated_at FROM at_audit_allocations WHERE chart_id = %s", [chart_id])
        cols = [c[0] for c in cursor.description]
        results['at_audit_allocations'] = [dict(zip(cols, r)) for r in cursor.fetchall()]

    return results

if __name__ == "__main__":
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    chart_info = check_chart('44189294')
    with open('chart_data_final.json', 'w', encoding='utf-8') as f:
        json.dump(chart_info, f, indent=4, default=str)
    print("Done")
