import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    print("Finding default constraints on project_field_config.dos_flag...")
    cursor.execute("""
        SELECT d.name
        FROM sys.default_constraints d
        INNER JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id
        WHERE d.parent_object_id = OBJECT_ID('project_field_config') AND c.name = 'dos_flag'
    """)
    row = cursor.fetchone()
    if row:
        constraint_name = row[0]
        print(f"Found default constraint: {constraint_name}. Dropping it...")
        cursor.execute(f"ALTER TABLE project_field_config DROP CONSTRAINT {constraint_name}")
        print("Constraint dropped.")

    print("Altering dos_flag column type...")
    try:
        cursor.execute("ALTER TABLE project_field_config ALTER COLUMN dos_flag NVARCHAR(MAX) NULL")
        print("Successfully altered dos_flag to NVARCHAR(MAX)")
    except Exception as e:
        print(f"Error altering column: {e}")
