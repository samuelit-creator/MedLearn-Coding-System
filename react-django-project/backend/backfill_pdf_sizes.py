
import os
import django
from django.db import connection
from pathlib import Path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT id, file_path FROM project_pdfs WHERE file_size IS NULL")
    rows = cursor.fetchall()
    
    print(f"Found {len(rows)} PDFs to backfill size")
    
    updated_count = 0
    missing_files = 0
    
    for pid, path_str in rows:
        path = Path(path_str)
        if path.exists():
            size = path.stat().st_size
            cursor.execute("UPDATE project_pdfs SET file_size = %s WHERE id = %s", (size, pid))
            updated_count += 1
        else:
            missing_files += 1
            print(f"File not found: {path_str}")
            
    print(f"Successfully updated {updated_count} rows")
    if missing_files > 0:
        print(f"Warning: {missing_files} files were missing on disk")

print("Backfill complete")
