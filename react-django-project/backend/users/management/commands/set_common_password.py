from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from django.db import connection

class Command(BaseCommand):
    help = "Set common password for all users"

    def handle(self, *args, **kwargs):
        # Generate the hash once to reuse in the query
        password_hash = make_password("MLV@2025")

        with connection.cursor() as cursor:
            # CHANGED: Replace '?' with '%s' for MSSQL compatibility
            cursor.execute("""
                INSERT INTO user_passwords (user_employee_id, password_hash)
                SELECT user_employee_id, %s
                FROM user_details
                WHERE user_employee_id NOT IN (
                    SELECT user_employee_id FROM user_passwords
                )
            """, (password_hash,))

        self.stdout.write(self.style.SUCCESS("✅ Passwords created successfully"))