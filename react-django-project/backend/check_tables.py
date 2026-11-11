import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_name LIKE '%leave%' ORDER BY table_name")
    tables = cursor.fetchall()
    print("--- LEAVE TABLES ---")
    for t in tables:
        print(t[0])
    print("--------------------")

    if not tables:
        print("No tables with 'leave' found in information_schema.tables.")
        # Try a broader search for all tables to see if I missed anything
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY table_name")
        all_tables = cursor.fetchall()
        print(f"Total tables found: {len(all_tables)}")
        # Print first 20 and last 20
        for t in all_tables[:20]:
            print(t[0])
        print("...")
        for t in all_tables[-20:]:
            print(t[0])
