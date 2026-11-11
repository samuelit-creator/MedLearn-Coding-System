import os
import django
from django.db import connection

def check_counts():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("--- AUDIT ERRORS STATS ---")
        cursor.execute("SELECT COUNT(*) FROM audit_errors")
        print(f"Total audit_errors: {cursor.fetchone()[0]}")

        cursor.execute("SELECT COUNT(DISTINCT row_id) FROM audit_errors")
        print(f"Unique row_ids in audit_errors: {cursor.fetchone()[0]}")

        cursor.execute("SELECT COUNT(*) FROM audit_dx_entries")
        print(f"Total audit_dx_entries: {cursor.fetchone()[0]}")

        cursor.execute("""
            SELECT COUNT(*) 
            FROM audit_errors e
            LEFT JOIN audit_dx_entries r ON e.row_id = r.id
            WHERE r.id IS NULL
        """)
        print(f"Audit errors missing dx entries: {cursor.fetchone()[0]}")

        print("\n--- AT-AUDIT ERRORS STATS ---")
        cursor.execute("SELECT COUNT(*) FROM at_audit_errors")
        print(f"Total at_audit_errors: {cursor.fetchone()[0]}")

        cursor.execute("SELECT COUNT(DISTINCT row_id) FROM at_audit_errors")
        print(f"Unique row_ids in at_audit_errors: {cursor.fetchone()[0]}")

        cursor.execute("SELECT COUNT(*) FROM at_audit_dx_entries")
        print(f"Total at_audit_dx_entries: {cursor.fetchone()[0]}")

        cursor.execute("""
            SELECT COUNT(*) 
            FROM at_audit_errors e
            LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
            WHERE r.id IS NULL
        """)
        print(f"AT-Audit errors missing dx entries: {cursor.fetchone()[0]}")

        print("\n--- LOGIC CHECK (AUDIT) ---")
        cursor.execute("""
            WITH DedupAuditErrors AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY row_id ORDER BY created_at DESC) as rn
                    FROM audit_errors
                ) t WHERE rn = 1
            )
            SELECT COUNT(*) FROM DedupAuditErrors
        """)
        print(f"Dedup audit count: {cursor.fetchone()[0]}")

        cursor.execute("""
            WITH DedupAuditErrors AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY row_id ORDER BY created_at DESC) as rn
                    FROM audit_errors
                ) t WHERE rn = 1
            )
            SELECT COUNT(*) 
            FROM DedupAuditErrors e
            JOIN audit_dx_entries r ON e.row_id = r.id
            JOIN codings c ON c.chart_id = e.chart_id
            JOIN audit_allocations a ON a.chart_id = e.chart_id
        """)
        print(f"Count after all joins (Audit): {cursor.fetchone()[0]}")

if __name__ == "__main__":
    check_counts()
