import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT name FROM sys.databases")
        dbs = cursor.fetchall()
        print("--- ALL DATABASES ---")
        for db in dbs:
            print(db[0])
        print("---------------------")
    except Exception as e:
        print(f"Error listing databases: {e}")
