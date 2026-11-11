import os
import django
import json
from django.db import connection

def check_access(chart_id, auditor_id):
    results = {}
    with connection.cursor() as cursor:
        # Check Auditor Profile
        cursor.execute("SELECT user_employee_id, username, user_profile, tl_employee_id FROM user_details WHERE user_employee_id = %s", [auditor_id])
        results['auditor'] = cursor.fetchone()

        # Check Coder Profile
        cursor.execute("""
            SELECT u.user_employee_id, u.username, u.user_profile, u.tl_employee_id 
            FROM user_details u
            WHERE u.user_employee_id = (SELECT user_id FROM codings WHERE chart_id = %s)
        """, [chart_id])
        results['coder'] = cursor.fetchone()

        # Check if Auditor is in Coder's hierarchy (upwards)
        # This is harder to query genericly without recursion, but let's just see their TLs
    return results

if __name__ == "__main__":
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    info = check_access('44189294', 'MLV1121')
    with open('hierarchy_check.json', 'w', encoding='utf-8') as f:
        json.dump(info, f, indent=4, default=str)
    print("Done")
