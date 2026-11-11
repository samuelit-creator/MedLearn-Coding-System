import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("SELECT table_name FROM information_schema.views WHERE table_schema != 'sys' AND table_name LIKE '%Leave%'")
        views = cursor.fetchall()
        print("--- Leave VIEWS in masterdata ---")
        for v in views:
            print(v[0])
        print("---------------------------------")
        
        # Also check all views
        cursor.execute("SELECT table_name FROM information_schema.views WHERE table_schema != 'sys'")
        all_views = cursor.fetchall()
        print(f"Total views: {len(all_views)}")
        for v in all_views:
            print(v[0])
    except Exception as e:
        print(f"Error checking views: {e}")
