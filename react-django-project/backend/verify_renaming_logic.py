import os
import django
from django.db import connection

def verify_logic():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    
    with connection.cursor() as cursor:
        print("Inserting test duplicates into 'project_pdfs'...")
        # Note: We use a path that is unlikely to exist to avoid messing with real data
        test_path = 'verification_test_duplicate.pdf'
        
        # Check if project table has rows to link to (optional but safer)
        # However, looking at the schema from previous scripts, project_pdfs has id, file_path, etc.
        # Let's just insert with minimal fields
        try:
            cursor.execute("INSERT INTO project_pdfs (file_path) VALUES (%s), (%s)", (test_path, test_path))
            connection.commit()
            print("Test duplicates inserted.")
            
            # Run renaming
            from rename_duplicate_pdfs import rename_duplicates
            rename_duplicates()
            
            # Verify results
            cursor.execute("SELECT id, file_path FROM project_pdfs WHERE file_path LIKE 'verification_test_duplicate%%'")
            results = cursor.fetchall()
            print("Results after renaming:")
            for row in results:
                print(f"ID: {row[0]}, Path: {row[1]}")
            
            # Cleanup
            cursor.execute("DELETE FROM project_pdfs WHERE file_path LIKE 'verification_test_duplicate%%'")
            connection.commit()
            print("Test data cleaned up.")
            
        except Exception as e:
            print(f"Error during verification: {e}")
            connection.rollback()

if __name__ == "__main__":
    verify_logic()
