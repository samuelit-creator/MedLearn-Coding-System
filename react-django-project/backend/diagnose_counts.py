from django.db import connection
import os
import django

def diagnose():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("--- Audit Errors Analysis ---")
        cursor.execute("SELECT COUNT(*) FROM audit_errors")
        total_e = cursor.fetchone()[0]
        print(f"Total rows in audit_errors: {total_e}")
        
        # Branch 1 candidates
        cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE coder_action = 'disagree' AND coder_tl_action IS NULL")
        b1 = cursor.fetchone()[0]
        print(f"Branch 1 (Coder TL Pending): {b1}")
        
        # Branch 2 candidates
        cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE coder_tl_action = 'disagree' AND audit_action IS NULL")
        b2 = cursor.fetchone()[0]
        print(f"Branch 2 (Auditor Pending): {b2}")
        
        # Branch 3 candidates
        cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE audit_action = 'disagree' AND audit_tl_action IS NULL")
        b3 = cursor.fetchone()[0]
        print(f"Branch 3 (Auditor TL Pending): {b3}")
        
        # Terminated chains
        cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE audit_tl_action IS NOT NULL OR coder_tl_action = 'agree' OR audit_action = 'agree'")
        term = cursor.fetchone()[0]
        print(f"Terminated/Closed rows: {term}")
        
        print(f"Sum of B1+B2+B3+Closed: {b1+b2+b3+term}")
        
        print("\n--- Join Check ---")
        # Check if rows are dropped due to joins
        cursor.execute("""
            SELECT COUNT(*) 
            FROM audit_errors e
            LEFT JOIN audit_dx_entries r ON e.row_id = r.id
            WHERE r.id IS NULL
        """)
        missing_dx = cursor.fetchone()[0]
        print(f"Rows missing audit_dx_entries: {missing_dx}")
        
        cursor.execute("""
            SELECT COUNT(*) 
            FROM audit_errors e
            LEFT JOIN (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY created_at DESC) as rn
                    FROM codings
                ) t WHERE rn = 1
            ) c ON c.chart_id = e.chart_id
            WHERE c.chart_id IS NULL
        """)
        missing_cod = cursor.fetchone()[0]
        print(f"Rows missing DedupCodings: {missing_cod}")

        cursor.execute("""
            SELECT COUNT(*) 
            FROM audit_errors e
            LEFT JOIN (
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chart_id ORDER BY allocated_at DESC) as rn
                    FROM audit_allocations
                ) t WHERE rn = 1
            ) a ON a.chart_id = e.chart_id
            WHERE a.chart_id IS NULL
        """)
        missing_alloc = cursor.fetchone()[0]
        print(f"Rows missing DedupAuditAlloc: {missing_alloc}")

        print("\n--- AT-Audit Errors Analysis ---")
        cursor.execute("SELECT COUNT(*) FROM at_audit_errors")
        total_at = cursor.fetchone()[0]
        print(f"Total rows in at_audit_errors: {total_at}")

if __name__ == "__main__":
    diagnose()
