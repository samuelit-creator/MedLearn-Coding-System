
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audit_dx_entries'")
    columns = cursor.fetchall()
    if columns:
        print("Table audit_dx_entries exists with columns:")
        for col in columns:
            print(col)
    else:
        print("Table audit_dx_entries DOES NOT EXIST.")
