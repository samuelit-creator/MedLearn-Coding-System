import PyPDF2
from django.core.management.base import BaseCommand
from django.db import connection
import os
from pathlib import Path

class Command(BaseCommand):
    help = "Backfill page counts for existing PDFs in project_pdfs table"

    def handle(self, *args, **kwargs):
        with connection.cursor() as cursor:
            # 1. Fetch PDFs where page_count is NULL or 0
            cursor.execute("""
                SELECT id, file_path, file_name 
                FROM project_pdfs 
                WHERE page_count IS NULL OR page_count = 0
            """)
            rows = cursor.fetchall()
            
            if not rows:
                self.stdout.write(self.style.SUCCESS("No PDFs found that need backfilling."))
                return

            self.stdout.write(f"Found {len(rows)} PDFs to process...")

            success_count = 0
            error_count = 0

            for pdf_id, file_path, file_name in rows:
                if not file_path:
                    self.stdout.write(self.style.WARNING(f"Skipping PDF ID {pdf_id}: empty file_path"))
                    continue

                full_path = Path(file_path)
                
                if not full_path.exists():
                    self.stdout.write(self.style.ERROR(f"File not found: {full_path}"))
                    error_count += 1
                    continue

                try:
                    with open(full_path, "rb") as pdf_file:
                        reader = PyPDF2.PdfReader(pdf_file)
                        page_count = len(reader.pages)
                    
                    # 2. Update database
                    cursor.execute("""
                        UPDATE project_pdfs 
                        SET page_count = %s 
                        WHERE id = %s
                    """, (page_count, pdf_id))
                    
                    success_count += 1
                    self.stdout.write(f"Updated {file_name}: {page_count} pages")

                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"Error processing {file_name}: {e}"))
                    error_count += 1

        self.stdout.write(self.style.SUCCESS(f"✅ Finished. Successfully updated: {success_count}, Errors: {error_count}"))
