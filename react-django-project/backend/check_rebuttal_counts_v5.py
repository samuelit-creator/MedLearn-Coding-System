import os
import django
from django.db import connection

def check_counts():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        with open("null_action_counts.txt", "w", encoding="utf-8") as f:
            cursor.execute("SELECT COUNT(*) FROM audit_errors WHERE coder_action IS NULL")
            f.write(f"Audit errors with NULL coder_action: {cursor.fetchone()[0]}\n")

            cursor.execute("SELECT COUNT(*) FROM at_audit_errors WHERE coder_action IS NULL")
            f.write(f"AT-Audit errors with NULL coder_action: {cursor.fetchone()[0]}\n")

if __name__ == "__main__":
    check_counts()
