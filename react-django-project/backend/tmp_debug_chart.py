import pyodbc
import json

def find_standard_duplicates():
    conn_str = (
        r'DRIVER={ODBC Driver 11 for SQL Server};'
        r'SERVER=MEDLEARNSERVER\SQLEXPRESS;'
        r'DATABASE=masterdata;'
        r'Trusted_Connection=yes;'
    )
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    print("--- Searching for Duplicates in audit_errors (Standard) ---")

    cursor.execute("""
        SELECT chart_id, row_id, error_type, COUNT(*) as cnt, MIN(created_at) as first_err, MAX(created_at) as last_err
        FROM audit_errors
        GROUP BY chart_id, row_id, error_type
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
    """)
    cols = [column[0] for column in cursor.description]
    duplicates = [dict(zip(cols, row)) for row in cursor.fetchall()]

    results = {"standard_duplicates": duplicates}

    if duplicates:
        top_chart = duplicates[0]["chart_id"]
        top_row = duplicates[0]["row_id"]
        print(f"Top chart with standard duplicates: {top_chart}, row: {top_row}")
        
        cursor.execute("SELECT * FROM audit_errors WHERE chart_id = ? AND row_id = ? ORDER BY created_at", (top_chart, top_row))
        cols = [column[0] for column in cursor.description]
        results["standard_chart_errors"] = [dict(zip(cols, row)) for row in cursor.fetchall()]

    with open("debug_results.json", "w") as f:
        json.dump(results, f, indent=4, default=str)
    
    print("Results written to debug_results.json")
    conn.close()

if __name__ == "__main__":
    find_standard_duplicates()
