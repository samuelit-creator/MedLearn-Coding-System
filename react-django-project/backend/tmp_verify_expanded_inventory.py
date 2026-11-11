import os
import sys
import django
import json

# Add project root to path
sys.path.append(r'c:\reactjs\react-django-project\backend')

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
try:
    django.setup()
except Exception as e:
    print(f"Django setup error: {e}")
    sys.exit(1)

from django.test import RequestFactory
from users.views import inventory_user_summary_api, inventory_team_summary_api, ACTIVE_TOKENS

def test_summaries():
    factory = RequestFactory()
    token = "test-token-456"
    ACTIVE_TOKENS[token] = {"emp_id": "123", "role": "Manager"}
    
    # Test User Summary
    request_user = factory.get('/api/inventory/user-summary/', HTTP_AUTHORIZATION=f"Bearer {token}")
    res_user = inventory_user_summary_api(request_user)
    print(f"User Summary Status: {res_user.status_code}")
    if res_user.status_code == 200:
        data = json.loads(res_user.content)
        print(f"User records: {len(data)}")
        if data: print(f"Sample: {data[0]}")
        
    # Test Team Summary
    request_team = factory.get('/api/inventory/team-summary/', HTTP_AUTHORIZATION=f"Bearer {token}")
    res_team = inventory_team_summary_api(request_team)
    print(f"Team Summary Status: {res_team.status_code}")
    if res_team.status_code == 200:
        data = json.loads(res_team.content)
        print(f"Team records: {len(data)}")
        if data: print(f"Sample: {data[0]}")

if __name__ == "__main__":
    test_summaries()
