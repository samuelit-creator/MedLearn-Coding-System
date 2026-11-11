
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    for tbl in ['dx_entries', 'audit_dx_entries', 'audit_allocations', 'codings']:
        cursor.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{tbl}'")
        cols = [c[0].lower() for c in cursor.fetchall()]
        print(f"Columns in {tbl}: {', '.join(cols)}")
