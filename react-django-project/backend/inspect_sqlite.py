import sqlite3

def check_sqlite():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        print("--- Tables in db.sqlite3 ---")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        for table in tables:
            print(table[0])
            
        # If there's a settings or config table, dump it
        for table in [t[0] for t in tables]:
            if 'setting' in table.lower() or 'config' in table.lower():
                print(f"\n--- Data from {table} ---")
                cursor.execute(f"SELECT * FROM {table}")
                for row in cursor.fetchall():
                    print(row)
        
        conn.close()
    except Exception as e:
        print(f"Error checking sqlite: {e}")

if __name__ == "__main__":
    check_sqlite()
