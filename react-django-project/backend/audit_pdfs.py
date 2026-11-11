import os
import django
from django.db import connection

def audit_pdfs():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    media_root = os.path.join('c:\\reactjs\\react-django-project\\backend', 'media', 'pdfs')
    print(f"--- Auditing PDFs in {media_root} ---")
    
    # 0. Check columns
    with connection.cursor() as cursor:
        cursor.execute("SELECT TOP 1 * FROM project_pdfs")
        columns = [col[0] for col in cursor.description]
        print(f"Table Columns: {columns}")
        
        # 1. Get all files on disk
        if not os.path.exists(media_root):
            print(f"CRITICAL: Directory {media_root} does not exist!")
            files_on_disk = set()
        else:
            files_on_disk = set(os.listdir(media_root))
        
        # 2. Get all entries from DB
        print("\n[Database vs Filesystem]")
        # Dynamically select columns that exist
        col_list = ",".join([c for c in ['id', 'file_path', 'project', 'subproject', 'page_count'] if c in columns])
        if not col_list: col_list = "*"
        
        cursor.execute(f"SELECT {col_list} FROM project_pdfs")
        db_entries = cursor.fetchall()
        
        # Map columns to indices
        try:
            path_idx = [c for c in col_list.split(',')].index('file_path')
            id_idx = [c for c in col_list.split(',')].index('id')
        except:
            path_idx = 1 # fallback
            id_idx = 0
            
        missing_on_disk = []
        found_on_disk = []
        
        for row in db_entries:
            db_id = row[id_idx]
            db_path = row[path_idx]
            
            # Extract filename from path
            if db_path:
                filename = os.path.basename(db_path)
                if filename in files_on_disk:
                    found_on_disk.append(filename)
                else:
                    missing_on_disk.append((db_id, db_path))
            else:
                missing_on_disk.append((db_id, "NULL PATH"))

        print(f"Total DB entries: {len(db_entries)}")
        print(f"Files found on disk: {len(found_on_disk)}")
        print(f"Missing Files (DB entries without file): {len(missing_on_disk)}")
        
        print("\n--- Top 20 Missing Files ---")
        for db_id, path in missing_on_disk[:20]:
            if "602" in str(path):
                print(f"ID: {db_id}, Path: {path} (HIT)")
            else:
                print(f"ID: {db_id}, Path: {path}")

    # 3. Check for orphaned files (on disk but not in DB)
    orphaned = files_on_disk - set(found_on_disk)
    print(f"\nOrphaned Files (on disk but not in DB): {len(orphaned)}")
    print("\n--- Top 20 Orphaned Files ---")
    for f in list(orphaned)[:20]:
        print(f"File: {f}")

if __name__ == "__main__":
    audit_pdfs()
