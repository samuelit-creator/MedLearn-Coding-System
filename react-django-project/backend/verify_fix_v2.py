import django
import os
import sys
import json
from django.test import RequestFactory
from django.http import JsonResponse

# Setup Django environment
sys.path.append('c:/reactjs/react-django-project/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from users.views import audit_open_chart_api, ACTIVE_TOKENS

def verify_audit_api(chart_id):
    print(f"--- Verifying audit_open_chart_api for chart_id {chart_id} ---")
    
    # Mock a token and user in ACTIVE_TOKENS
    mock_token = "test_token_123"
    ACTIVE_TOKENS[mock_token] = {
        "emp_id": "MLV1234",
        "role": "Auditor"
    }
    
    factory = RequestFactory()
    url = f"/api/audit/chart/{chart_id}/"
    request = factory.get(url)
    request.META['HTTP_AUTHORIZATION'] = f"Bearer {mock_token}"
    
    try:
        response = audit_open_chart_api(request, chart_id)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print("Success: API returned 200 OK")
            print("Response Data Keys:", json.loads(response.content.decode('utf-8')).keys())
        else:
            print(f"Failure: API returned {response.status_code}")
            print(f"Response Content: {response.content.decode('utf-8')}")
    except Exception as e:
        print(f"Exception occurred: {e}")
        import traceback
        traceback.print_exc()

# Use the chart_id from the user request
verify_audit_api(20659705)
