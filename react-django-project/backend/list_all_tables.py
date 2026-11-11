import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_name")
    tables = cursor.fetchall()
    with open('all_tables.txt', 'w') as f:
        for t in tables:
            f.write(t[0] + '\n')
    print(f"Total tables: {len(tables)}")
