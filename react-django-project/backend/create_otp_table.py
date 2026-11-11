import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.db import connection

try:
    with connection.cursor() as c:
        c.execute("IF OBJECT_ID('user_otps', 'U') IS NOT NULL DROP TABLE user_otps")
        c.execute("""
            CREATE TABLE user_otps (
                user_employee_id NVARCHAR(255) PRIMARY KEY,
                otp NVARCHAR(10) NOT NULL,
                created_at DATETIME DEFAULT GETDATE(),
                expires_at DATETIME NOT NULL
            )
        """)
        c.execute("commit;")
    print("Table user_otps recreated successfully.")
except Exception as e:
    print("Error:", e)