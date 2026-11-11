import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'dx_entries' AND COLUMN_NAME = 'DOS_Flag'
    """)
    print("dx_entries DOS_Flag:")
    for row in cursor.fetchall():
        print(row)
        
    cursor.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'audit_dx_entries' AND COLUMN_NAME = 'DOS_Flag'
    """)
    print("audit_dx_entries DOS_Flag:")
    for row in cursor.fetchall():
        print(row)
