import pyodbc
conn = pyodbc.connect('DRIVER={ODBC Driver 11 for SQL Server};SERVER=MEDLEARNSERVER\\SQLEXPRESS;DATABASE=masterdata;Trusted_Connection=yes;')
cursor = conn.cursor()

try:
    cursor.execute("SELECT * FROM user_passwords WHERE user_employee_id = 'mlv1404'")
    columns = [column[0] for column in cursor.description]
    print("Columns:", columns)
    row = cursor.fetchone()
    if row:
        print("Current Row:", dict(zip(columns, row)))
    else:
        print("User not found.")
except Exception as e:
    print("Error:", e)
