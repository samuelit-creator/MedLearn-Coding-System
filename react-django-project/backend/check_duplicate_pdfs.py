import os
import django
from django.db import connection

def check_duplicates():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT file_path, COUNT(*)
            FROM project_pdfs
            GROUP BY file_path
            HAVING COUNT(*) > 1
        """)
        dupes = cursor.fetchall()
        print("--- Duplicate file_paths in 'project_pdfs' ---")
        for dupe in dupes:
            print(f"Path: {dupe[0]}, Count: {dupe[1]}")

if __name__ == "__main__":
    check_duplicates()
