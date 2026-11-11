import os
import django
from django.db import connection

def check_deep_duplicates():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # 1. Check duplicate pdf_path_hash
        print("--- Duplicate pdf_path_hash ---")
        cursor.execute("""
            SELECT pdf_path_hash, COUNT(*) 
            FROM project_pdfs 
            WHERE pdf_path_hash IS NOT NULL AND pdf_path_hash != ''
            GROUP BY pdf_path_hash 
            HAVING COUNT(*) > 1
        """)
        hash_dupes = cursor.fetchall()
        if not hash_dupes:
            print("No duplicate hashes found.")
        else:
            for h, count in hash_dupes:
                print(f"Hash: {h}, Count: {count}")
                cursor.execute("SELECT id, file_name, file_path, uploaded_at FROM project_pdfs WHERE pdf_path_hash = %s", (h,))
                for row in cursor.fetchall():
                    print(f"  ID: {row[0]}, Name: {row[1]}, Path: {row[2]}, Uploaded: {row[3]}")

        # 2. Check duplicate file_name
        print("\n--- Duplicate file_name ---")
        cursor.execute("""
            SELECT file_name, COUNT(*) 
            FROM project_pdfs 
            GROUP BY file_name 
            HAVING COUNT(*) > 1
        """)
        name_dupes = cursor.fetchall()
        if not name_dupes:
            print("No duplicate filenames found.")
        else:
            for name, count in name_dupes:
                print(f"Name: {name}, Count: {count}")
                cursor.execute("SELECT id, file_path FROM project_pdfs WHERE file_name = %s", (name,))
                for row in cursor.fetchall():
                    print(f"  ID: {row[0]}, Path: {row[1]}")

        # 3. Analyze the strange 404 pattern (ID_1 (N).pdf)
        print("\n--- Analyzing 404 Pattern IDs 577-602 ---")
        cursor.execute("""
            SELECT id, file_name, file_path, uploaded_at 
            FROM project_pdfs 
            WHERE id BETWEEN 577 AND 602
        """)
        for row in cursor.fetchall():
            print(f"ID: {row[0]}, Name: {row[1]}, Path: {row[2]}, Uploaded: {row[3]}")

if __name__ == "__main__":
    check_deep_duplicates()
