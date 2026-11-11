
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'codings'")
    columns = cursor.fetchall()
    print("CODINGS COLUMNS:")
    for col in columns:
        print(f"  {col[0]} ({col[1]})")

    cursor.execute("SELECT COUNT(*) FROM codings WHERE project_pdf_id IS NULL")
    null_count = cursor.fetchone()[0]
    print(f"\nRows with NULL project_pdf_id: {null_count}")

    cursor.execute("SELECT COUNT(*) FROM project_pdfs")
    pdf_count = cursor.fetchone()[0]
    print(f"Total rows in project_pdfs: {pdf_count}")

    # Check a sample request
    cursor.execute("SELECT DISTINCT project, subproject FROM project_pdfs")
    print("\nProjects/Subprojects in project_pdfs:")
    for row in cursor.fetchall():
        print(row)
