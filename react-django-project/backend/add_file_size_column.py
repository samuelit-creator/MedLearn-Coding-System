
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    try:
        cursor.execute("ALTER TABLE project_pdfs ADD file_size BIGINT NULL")
        print("Successfully added file_size column to project_pdfs")
    except Exception as e:
        print(f"Error adding column: {e}")

print("Schema update complete")
