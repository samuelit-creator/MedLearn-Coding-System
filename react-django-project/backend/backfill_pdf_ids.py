
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    # Get mapping of file_path to id from project_pdfs
    cursor.execute("SELECT id, file_path FROM project_pdfs")
    pdf_mapping = {path: pid for pid, path in cursor.fetchall()}
    
    print(f"Found {len(pdf_mapping)} PDFs in project_pdfs")
    
    # Get codings with NULL project_pdf_id
    cursor.execute("SELECT id, pdf_path FROM codings WHERE project_pdf_id IS NULL")
    codings_to_update = cursor.fetchall()
    
    print(f"Found {len(codings_to_update)} codings to update")
    
    updated_count = 0
    missing_mapping = 0
    
    for cid, path in codings_to_update:
        if path in pdf_mapping:
            pid = pdf_mapping[path]
            cursor.execute("UPDATE codings SET project_pdf_id = %s WHERE id = %s", (pid, cid))
            updated_count += 1
        else:
            missing_mapping += 1
            
    print(f"Successfully updated {updated_count} rows")
    if missing_mapping > 0:
        print(f"Warning: {missing_mapping} rows could not be matched by pdf_path")

print("Backfill complete")
