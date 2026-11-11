
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    with open('debug_log.txt', 'w') as f:
        cursor.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'codings'")
        columns = cursor.fetchall()
        f.write("CODINGS COLUMNS:\n")
        for col in columns:
            f.write(f"  {col[0]} ({col[1]})\n")

        cursor.execute("SELECT COUNT(*) FROM codings WHERE project_pdf_id IS NULL")
        null_count = cursor.fetchone()[0]
        f.write(f"\nRows with NULL project_pdf_id: {null_count}\n")

        cursor.execute("SELECT COUNT(*) FROM project_pdfs")
        pdf_count = cursor.fetchone()[0]
        f.write(f"Total rows in project_pdfs: {pdf_count}\n")

        cursor.execute("SELECT DISTINCT project, subproject FROM project_pdfs")
        f.write("\nProjects/Subprojects in project_pdfs:\n")
        for row in cursor.fetchall():
            f.write(f"  {row}\n")

        # Check if there are ANY PDFs that match the expected criteria
        # I'll just check all for now
        cursor.execute("SELECT id, project, subproject FROM project_pdfs")
        all_pdfs = cursor.fetchall()
        f.write("\nAll PDFs in project_pdfs (first 10):\n")
        for row in all_pdfs[:10]:
            f.write(f"  {row}\n")
print("Debug info written to debug_log.txt")
