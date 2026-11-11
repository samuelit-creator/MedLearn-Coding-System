import os
import django
from django.db import connection

def check_schema():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    output_file = 'schema_debug_output.txt'
    with open(output_file, 'w') as f:
        with connection.cursor() as cursor:
            # Columns
            f.write("--- Columns in 'codings' ---\n")
            cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'codings'")
            for col in cursor.fetchall():
                f.write(f"{col[0]}: {col[1]}\n")
            
            # Constraints
            f.write("\n--- Columns in 'uq_user_pdf' ---\n")
            cursor.execute("""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE CONSTRAINT_NAME = 'uq_user_pdf'
                ORDER BY ORDINAL_POSITION
            """)
            for col in cursor.fetchall():
                f.write(f"{col[0]}\n")

            # Triggers
            f.write("\n--- Triggers on 'codings' ---\n")
            cursor.execute("""
                SELECT name, OBJECT_DEFINITION(object_id) as definition
                FROM sys.triggers
                WHERE parent_id = OBJECT_ID('codings')
            """)
            for t in cursor.fetchall():
                f.write(f"Trigger: {t[0]}\n")
                f.write(f"Definition: {t[1]}\n\n")

    print(f"Results written to {output_file}")

if __name__ == "__main__":
    check_schema()
