import os
import django
from django.db import connection

def analyze_dupes_and_fix():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("--- Finding duplicate hashes and filename patterns ---")
        
        # We need to find entries that effectively represent the same physical file
        # Pattern 1: Same hash
        cursor.execute("""
            SELECT pdf_path_hash, COUNT(*) 
            FROM project_pdfs 
            WHERE pdf_path_hash IS NOT NULL AND pdf_path_hash != ''
            GROUP BY pdf_path_hash 
            HAVING COUNT(*) > 1
        """)
        hash_groups = cursor.fetchall()
        print(f"Duplicate hash groups: {len(hash_groups)}")
        
        # Pattern 2: Different IDs pointing to the same file_name (e.g. 1 (1).pdf)
        # but with broken prefixes in file_path
        cursor.execute("""
            SELECT file_name, COUNT(*) 
            FROM project_pdfs 
            GROUP BY file_name 
            HAVING COUNT(*) > 1
        """)
        name_groups = cursor.fetchall()
        print(f"Duplicate name groups: {len(name_groups)}")

        # For these pairs, let's see their project/subproject
        print("\n--- Sample of duplicate name groups (ID, Project, Subproject, Path) ---")
        for name, count in name_groups[:10]:
            print(f"\nName: {name}")
            cursor.execute("SELECT id, project, subproject, file_path FROM project_pdfs WHERE file_name = %s", (name,))
            for r in cursor.fetchall():
                print(f"  ID: {r[0]}, Project: {r[1]}, Sub: {r[2]}, Path: {r[3]}")

if __name__ == "__main__":
    analyze_dupes_and_fix()
