import os
import django
from django.db import connection

def drilldown():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        with open("drilldown.txt", "w", encoding="utf-8") as f:
            cursor.execute("SELECT COUNT(*) FROM at_audit_errors")
            f.write(f"Total entries in at_audit_errors: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM at_audit_errors e JOIN at_audit_dx_entries r ON e.row_id = r.id")
            f.write(f"After JOIN at_audit_dx_entries: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM at_audit_errors e JOIN at_audit_dx_entries r ON e.row_id = r.id JOIN codings c ON c.chart_id = e.chart_id")
            f.write(f"After JOIN codings: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM at_audit_errors e JOIN at_audit_dx_entries r ON e.row_id = r.id JOIN codings c ON c.chart_id = e.chart_id JOIN audit_allocations a ON a.chart_id = e.chart_id")
            f.write(f"After JOIN audit_allocations: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM at_audit_errors e JOIN at_audit_dx_entries r ON e.row_id = r.id JOIN codings c ON c.chart_id = e.chart_id JOIN audit_allocations a ON a.chart_id = e.chart_id JOIN at_audit_allocations aa ON aa.chart_id = e.chart_id")
            f.write(f"After JOIN at_audit_allocations: {cursor.fetchone()[0]}\n")

if __name__ == "__main__":
    drilldown()
