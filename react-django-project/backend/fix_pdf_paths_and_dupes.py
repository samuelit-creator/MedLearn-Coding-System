import os
import django
import shutil
import re
from django.db import connection

def fix_pdf_paths_and_dupes():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    media_root = os.path.join('c:\\reactjs\\react-django-project\\backend', 'media', 'pdfs')
    print(f"--- Starting PDF Path Fix and Deduplication in {media_root} ---")
    
    if not os.path.exists(media_root):
        print(f"CRITICAL: {media_root} does not exist. Aborting.")
        return

    # 1. Fetch all DB entries
    with connection.cursor() as cursor:
        cursor.execute("SELECT id, file_name, file_path FROM project_pdfs")
        db_entries = cursor.fetchall()
        
    print(f"Total DB entries to process: {len(db_entries)}")
    
    # 2. Track processed paths to handle duplicates
    # This stores the *final* path we intend to use for each entry
    final_paths_map = {} # id -> final_path
    path_counts = {}     # path -> count (for suffixing)
    
    # 3. First pass: Normalize and identify potential target files
    print("\n[Phase 1: Normalizing and matching physical files]")
    for db_id, file_name, file_path in db_entries:
        # Standardize: remove ID_ prefix from filename if it's missing on disk
        current_filename = os.path.basename(file_path)
        
        # Check if current filename exists
        if os.path.exists(os.path.join(media_root, current_filename)):
            target_filename = current_filename
        else:
            # Try removing the ID prefix (e.g. 577_1 (1).pdf -> 1 (1).pdf)
            # Pattern: matches digits followed by underscore at the start
            normalized_name = re.sub(r'^\d+_', '', current_filename)
            if os.path.exists(os.path.join(media_root, normalized_name)):
                target_filename = normalized_name
                print(f"  ID {db_id}: Normalized {current_filename} -> {normalized_name}")
            else:
                # Still not found? Keep the original and log it as still missing
                target_filename = current_filename
                print(f"  ID {db_id}: WARNING - File still missing: {current_filename}")

        # 4. Phase 2: Handle duplicate paths in the DB
        # If this target_filename is already taken by another ID, we MUST rename it
        if target_filename in path_counts:
            path_counts[target_filename] += 1
            base, ext = os.path.splitext(target_filename)
            final_filename = f"{base}_dup{path_counts[target_filename]-1}{ext}"
            print(f"  ID {db_id}: DUPLICATE PATH detected. New Path: {final_filename}")
        else:
            path_counts[target_filename] = 1
            final_filename = target_filename
            
        final_paths_map[db_id] = os.path.join(media_root, final_filename)

    # 4. Phase 3: Execute DB updates and physical file operations
    print("\n[Phase 2: Executing file operations and DB updates]")
    # We need to sort by final_filename to avoid collisions if we were renaming in place, 
    # but since we are copying, it's safer.
    
    with connection.cursor() as cursor:
        for db_id, file_name, file_path in db_entries:
            final_path = final_paths_map[db_id]
            final_filename = os.path.basename(final_path)
            
            # Skip if no change needed actually (path matches)
            if final_path.lower() == file_path.lower() and os.path.exists(final_path):
                continue
                
            # Perform physical copy if needed
            # Find the source file again
            source_filename = os.path.basename(file_path)
            source_path = os.path.join(media_root, source_filename)
            
            # If source doesn't exist, try normalized version
            if not os.path.exists(source_path):
                source_path = os.path.join(media_root, re.sub(r'^\d+_', '', source_filename))

            if os.path.exists(source_path):
                if source_path != final_path:
                    try:
                        shutil.copy2(source_path, final_path)
                        print(f"  COPY: {os.path.basename(source_path)} -> {final_filename}")
                    except Exception as e:
                        print(f"  ERROR copying: {e}")
                
                # Update DB
                try:
                    cursor.execute("UPDATE project_pdfs SET file_path = %s WHERE id = %s", (final_path, db_id))
                    print(f"  DB UPDATE: ID {db_id} -> {final_filename}")
                except Exception as e:
                    print(f"  ERROR updating DB: {e}")
            else:
                print(f"  SKIPPING ID {db_id}: Source file not found for {source_filename}")

    connection.commit()
    print("\nFix and Deduplication completed.")

if __name__ == "__main__":
    fix_pdf_paths_and_dupes()
