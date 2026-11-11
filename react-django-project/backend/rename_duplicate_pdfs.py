import os
import django
from django.db import connection

def rename_duplicates():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        # 1. Identify duplicates
        cursor.execute("""
            SELECT file_path, COUNT(*)
            FROM project_pdfs
            WHERE file_path IS NOT NULL AND file_path != ''
            GROUP BY file_path
            HAVING COUNT(*) > 1
        """)
        dupes = cursor.fetchall()
        
        if not dupes:
            print("No duplicate file_paths found.")
            return

        print(f"Found {len(dupes)} duplicate paths. Renaming...")

        for path, count in dupes:
            # 2. Get all IDs for this path, ordered by ID
            cursor.execute("""
                SELECT id FROM project_pdfs 
                WHERE file_path = %s 
                ORDER BY id
            """, (path,))
            ids = [row[0] for row in cursor.fetchall()]
            
            # Keep the first one, rename the rest
            original_id = ids[0]
            to_rename = ids[1:]
            
            print(f"Path: {path} (Keeping ID: {original_id}, Renaming IDs: {to_rename})")
            
            for i, row_id in enumerate(to_rename, 1):
                # Split path and extension to insert suffix before extension if possible
                base, ext = os.path.splitext(path)
                new_path = f"{base}_dup{i}{ext}"
                
                cursor.execute("""
                    UPDATE project_pdfs
                    SET file_path = %s
                    WHERE id = %s
                """, (new_path, row_id))
                print(f"  ID {row_id}: {path} -> {new_path}")

    print("Renaming completed.")

if __name__ == "__main__":
    rename_duplicates()
