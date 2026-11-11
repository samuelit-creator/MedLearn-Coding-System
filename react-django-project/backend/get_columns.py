import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT TOP 0 * FROM dx_entries")
    print("COLUMNS:")
    for col in cursor.description:
        print(f"  {col[0]}")
