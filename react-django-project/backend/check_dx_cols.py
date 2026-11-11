
import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

with connection.cursor() as cursor:
    cursor.execute("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'dx_entries'")
    columns = cursor.fetchall()
    print("dx_entries columns:")
    for col in columns:
        print(col)
