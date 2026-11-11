
import os
import django
import json
from django.test import RequestFactory
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from users.views import export_team_quality_api, ACTIVE_TOKENS

# Mock a token
mock_token = "reproduce-token"
# Find a supervisor (TL or Manager)
with connection.cursor() as cursor:
    cursor.execute("SELECT TOP 1 user_employee_id FROM user_details WHERE user_profile IN ('TL', 'Manager')")
    row = cursor.fetchone()
    if not row:
        print("No supervisors found in DB")
        # Fallback to any user
        cursor.execute("SELECT TOP 1 user_employee_id FROM user_details")
        row = cursor.fetchone()
    
    if not row:
        print("No users found in DB")
        exit(1)
    emp_id = row[0]

ACTIVE_TOKENS[mock_token] = {"emp_id": emp_id}

factory = RequestFactory()
request = factory.post('/api/export-team-quality/', 
                       data=json.dumps({}), 
                       content_type='application/json')
request.META['HTTP_AUTHORIZATION'] = f'Bearer {mock_token}'

print(f"Calling export_team_quality_api with emp_id: {emp_id}...")
try:
    response = export_team_quality_api(request)
    print(f"Response Status: {response.status_code}")
    if response.status_code == 500:
        with open('reproduce_error.log', 'w') as f:
            f.write(response.content.decode('utf-8'))
except Exception as e:
    print(f"Caught Exception: {e}")
    import traceback
    with open('reproduce_error.log', 'w') as f:
        f.write(traceback.format_exc())
