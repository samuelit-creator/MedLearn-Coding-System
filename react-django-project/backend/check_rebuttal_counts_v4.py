import os
import django
from django.db import connection

def check_counts():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        with open("detailed_counts.txt", "w", encoding="utf-8") as f:
            f.write("--- ORPHAN CHECK ---\n")
            cursor.execute("SELECT COUNT(*) FROM audit_errors e LEFT JOIN audit_dx_entries r ON e.row_id = r.id WHERE r.id IS NULL")
            f.write(f"Audit errors missing dx entries: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM audit_errors e LEFT JOIN codings c ON e.chart_id = c.chart_id WHERE c.chart_id IS NULL")
            f.write(f"Audit errors missing codings: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM audit_errors e LEFT JOIN audit_allocations a ON e.chart_id = a.chart_id WHERE a.chart_id IS NULL")
            f.write(f"Audit errors missing allocations: {cursor.fetchone()[0]}\n")

            f.write("\n--- DEDUP VS NO DEDUP ---\n")
            # All audit errors where coder_action is disagree OR agree
            cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE coder_action IS NOT NULL")
            f.write(f"Total audit errors with ANY coder action: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(DISTINCT row_id) FROM audit_errors WHERE coder_action IS NOT NULL")
            f.write(f"Unique row_ids with ANY coder action: {cursor.fetchone()[0]}\n")

            print("Diagnostics written to detailed_counts.txt")

if __name__ == "__main__":
    check_counts()
