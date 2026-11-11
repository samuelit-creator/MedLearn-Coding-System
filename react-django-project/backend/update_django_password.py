import os
import django
from django.contrib.auth.hashers import make_password
from django.db import connection

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

def update_password():
    new_password = 'MedLearn@Manager'
    hashed_password = make_password(new_password)
    user_id = 'mlv1404'
    
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE user_passwords SET password_hash = %s WHERE user_employee_id = %s",
            [hashed_password, user_id]
        )
        print(f"Password updated for {user_id}")

if __name__ == '__main__':
    update_password()
