import pyodbc
import os

# Try to find connection string or settings
# For now, let's try to query the schema of 'codings'

def check_schema():
    from django.db import connection
    import os
    import django
    
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # Get columns of 'codings'
        cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'codings'")
        cols = cursor.fetchall()
        print("--- Columns in 'codings' ---")
        for col in cols:
            print(f"{col[0]}: {col[1]}")
            
        # Get constraint details for 'uq_user_pdf'
        cursor.execute("""
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE CONSTRAINT_NAME = 'uq_user_pdf'
            ORDER BY ORDINAL_POSITION
        """)
        con_cols = cursor.fetchall()
        print("\n--- Columns in 'uq_user_pdf' ---")
        for col in con_cols:
            print(col[0])

        # Check for triggers on 'codings'
        print("\n--- Triggers on 'codings' ---")
        cursor.execute("""
            SELECT name, OBJECT_DEFINITION(object_id) as definition
            FROM sys.triggers
            WHERE parent_id = OBJECT_ID('codings')
        """)
        triggers = cursor.fetchall()
        for t in triggers:
            print(f"Trigger: {t[0]}")
            print(f"Definition: {t[1]}")

if __name__ == "__main__":
    try:
        check_schema()
    except Exception as e:
        print(f"Error: {e}")
