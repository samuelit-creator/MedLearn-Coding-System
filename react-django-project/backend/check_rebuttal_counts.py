import os
import django
import json
from django.db import connection

def check_counts():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # 1. Total rows in audit_errors
        cursor.execute("SELECT COUNT(*) FROM audit_errors")
        total_audit_errors = cursor.fetchone()[0]
        print(f"Total rows in audit_errors: {total_audit_errors}")

        # 2. Total rows in at_audit_errors
        cursor.execute("SELECT COUNT(*) FROM at_audit_errors")
        total_at_audit_errors = cursor.fetchone()[0]
        print(f"Total rows in at_audit_errors: {total_at_audit_errors}")

        # 3. Check for row_id mismatches
        cursor.execute("""
            SELECT COUNT(*) 
            FROM audit_errors e
            LEFT JOIN audit_dx_entries r ON e.row_id = r.id
            WHERE r.id IS NULL
        """)
        orphaned_audit_errors = cursor.fetchone()[0]
        print(f"Orphaned audit_errors (missing audit_dx_entries): {orphaned_audit_errors}")

        cursor.execute("""
            SELECT COUNT(*) 
            FROM at_audit_errors e
            LEFT JOIN at_audit_dx_entries r ON e.row_id = r.id
            WHERE r.id IS NULL
        """)
        orphaned_at_audit_errors = cursor.fetchone()[0]
        print(f"Orphaned at_audit_errors (missing at_audit_dx_entries): {orphaned_at_audit_errors}")

        # 4. Check for deduplication loss
        cursor.execute("SELECT COUNT(DISTINCT row_id) FROM audit_errors")
        distinct_audit_row_ids = cursor.fetchone()[0]
        print(f"Distinct row_ids in audit_errors: {distinct_audit_row_ids}")

        cursor.execute("SELECT COUNT(DISTINCT row_id) FROM at_audit_errors")
        distinct_at_audit_row_ids = cursor.fetchone()[0]
        print(f"Distinct row_ids in at_audit_errors: {distinct_at_audit_row_ids}")

        # 5. Check counts using the actual logic from UnifiedErrors (audit part only for simplicity)
        cursor.execute("""
            WITH DedupAuditErrors AS (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY row_id ORDER BY created_at DESC) as rn
                    FROM audit_errors
                ) t WHERE rn = 1
            )
            SELECT COUNT(*) FROM DedupAuditErrors
        """)
        dedup_audit_count = cursor.fetchone()[0]
        print(f"Count after DedupAuditErrors CTE: {dedup_audit_count}")

        # 6. Check counts after joining with audit_dx_entries
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
        """)
        join_audit_count = cursor.fetchone()[0]
        print(f"Count after JOIN audit_dx_entries: {join_audit_count}")

if __name__ == "__main__": check_counts()
