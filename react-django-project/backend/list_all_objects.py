import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT name, type_desc FROM sys.objects WHERE name LIKE '%Leave%'")
        objects = cursor.fetchall()
        print("--- Objects containing 'Leave' ---")
        for obj in objects:
            print(f"{obj[0]} ({obj[1]})")
        print("-------------------------------")
    except Exception as e:
        print(f"Error listing objects: {e}")
