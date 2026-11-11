import os
import django
from django.db import connection

def check_columns():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        try:
            cursor.execute("SELECT TOP 1 * FROM audit_errors")
            columns = [col[0] for col in cursor.description]
            print(f"audit_errors columns: {columns}")
        except Exception as e:
            print(f"Error checking audit_errors: {e}")

        try:
            cursor.execute("SELECT TOP 1 * FROM at_audit_errors")
            columns = [col[0] for col in cursor.description]
            print(f"at_audit_errors columns: {columns}")
        except Exception as e:
            print(f"Error checking at_audit_errors: {e}")

if __name__ == "__main__":
    check_columns()
