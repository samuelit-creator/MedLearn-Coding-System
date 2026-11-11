
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

sql = """
IF OBJECT_ID('audit_dx_entries', 'U') IS NULL
BEGIN
    CREATE TABLE audit_dx_entries (
        id INT IDENTITY(1,1) PRIMARY KEY,
        chart_id NVARCHAR(50),
        from_date DATE,
        to_date DATE,
        start_page NVARCHAR(50),
        end_page NVARCHAR(50),
        dxcode NVARCHAR(50),
        details NVARCHAR(MAX),
        provider NVARCHAR(255),
        eo NVARCHAR(100),
        pos NVARCHAR(100),
        dx_location NVARCHAR(100),
        meat_dec NVARCHAR(MAX),
        error_type NVARCHAR(100),
        error_count INT,
        error_command NVARCHAR(MAX),
        state NVARCHAR(50),
        user_action NVARCHAR(50),
        parent_id INT
    );
    PRINT 'Table audit_dx_entries created successfully.';
END
ELSE
BEGIN
    PRINT 'Table audit_dx_entries already exists.';
END
"""

with connection.cursor() as cursor:
    cursor.execute(sql)
