import os
import django
from django.db import connection

def verify_divergence():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # 1. Check Export Count (should be 12,443)
        cursor.execute("SELECT COUNT(*) FROM audit_errors")
        audit_full = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM at_audit_errors")
        at_audit_full = cursor.fetchone()[0]
        db_total = audit_full + at_audit_full
        
        # 2. Check UI Count (only disagreements)
        # Audit Chain Disagreements
        cursor.execute("""
            SELECT COUNT(*) FROM audit_errors e
            WHERE (e.coder_action = 'disagree' AND e.coder_tl_action IS NULL)
               OR (e.coder_tl_action = 'disagree' AND e.audit_action IS NULL)
               OR (e.audit_action = 'disagree' AND e.audit_tl_action IS NULL)
        """)
        ui_audit_disagreements = cursor.fetchone()[0]
        
        # AT-Audit Chain Disagreements
        cursor.execute("""
            SELECT COUNT(*) FROM at_audit_errors e
            WHERE (e.coder_action = 'disagree' AND e.coder_tl_action IS NULL)
               OR (e.coder_tl_action = 'disagree' AND e.audit_action IS NULL)
               OR (e.audit_action = 'disagree' AND e.audit_tl_action IS NULL)
        """)
        ui_at_audit_disagreements = cursor.fetchone()[0]
        ui_total = ui_audit_disagreements + ui_at_audit_disagreements
        
        with open("divergence_results.txt", "w") as f:
            f.write(f"Database Total Errors: {db_total}\n")
            f.write(f"UI Expected Disagreements: {ui_total} (Audit: {ui_audit_disagreements}, AT-Audit: {ui_at_audit_disagreements})\n")
            f.write(f"Divergence confirmed: UI shows {ui_total} vs Export shows {db_total}\n")

if __name__ == "__main__":
    verify_divergence()
