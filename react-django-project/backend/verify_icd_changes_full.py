import os
import django
from django.db import connection
import pandas as pd
import io

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

def verify():
    print("Checking project_field_config table for manual_icd_table column...")
    with connection.cursor() as cursor:
        cursor.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'project_field_config' AND COLUMN_NAME = 'manual_icd_table'")
        row = cursor.fetchone()
        if row:
            print("SUCCESS: manual_icd_table column exists.")
        else:
            print("FAILURE: manual_icd_table column NOT found.")

    print("\nTesting manual_icd_% table listing...")
    from users.views import _ensure_project_config_table
    _ensure_project_config_table() # Ensure column is there
    
    with connection.cursor() as cursor:
        cursor.execute("IF OBJECT_ID('manual_icd_test_table', 'U') IS NOT NULL DROP TABLE manual_icd_test_table")
        cursor.execute("CREATE TABLE manual_icd_test_table (code NVARCHAR(255), terms NVARCHAR(MAX))")
        cursor.execute("INSERT INTO manual_icd_test_table (code, terms) VALUES ('TEST01', 'Test Terms')")
        
    with connection.cursor() as cursor:
        cursor.execute("SELECT name FROM sysobjects WHERE name LIKE 'manual_icd_%' AND xtype='U'")
        tables = [r[0] for r in cursor.fetchall()]
        print(f"Tables found: {tables}")
        if 'manual_icd_test_table' in tables:
            print("SUCCESS: Test table found in list.")
        else:
            print("FAILURE: Test table NOT found in list.")

    print("\nVerifying icd_search_api logic (simulated)...")
    # Simulate a project config
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM project_field_config WHERE project='TEST_PROJ' AND subproject='TEST_SUB'")
        cursor.execute("INSERT INTO project_field_config (project, subproject, fields, manual_icd_table) VALUES (%s, %s, %s, %s)",
                       ('TEST_PROJ', 'TEST_SUB', '[]', 'manual_icd_test_table'))
    
    # Check if we can search it
    with connection.cursor() as cursor:
        cursor.execute("SELECT TOP 50 code, terms FROM manual_icd_test_table WHERE code LIKE '%%TEST%%'")
        rows = cursor.fetchall()
        print(f"Search results: {rows}")
        if len(rows) > 0 and rows[0][0] == 'TEST01':
            print("SUCCESS: Search works on dynamic table.")
        else:
            print("FAILURE: Search failed on dynamic table.")

    # Cleanup
    with connection.cursor() as cursor:
        cursor.execute("DROP TABLE manual_icd_test_table")
        cursor.execute("DELETE FROM project_field_config WHERE project='TEST_PROJ' AND subproject='TEST_SUB'")

if __name__ == "__main__":
    verify()
