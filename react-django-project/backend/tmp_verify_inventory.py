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
from users.views import inventory_list_api, ACTIVE_TOKENS

def test_inventory_list():
    factory = RequestFactory()
    
    # Mocking a token
    token = "test-token-123"
    ACTIVE_TOKENS[token] = {"emp_id": "123", "role": "Manager"}
    
    # Mocking the request properly for DRF if needed, but our view uses standard request
    request = factory.get('/api/inventory/list/')
    request.META['HTTP_AUTHORIZATION'] = f"Bearer {token}"
    
    # Manually adding the token to mimic extract_token
    # Since extract_token uses request.headers.get("Authorization")
    # In RequestFactory, headers can be passed in __init__
    request = factory.get('/api/inventory/list/', HTTP_AUTHORIZATION=f"Bearer {token}")
    
    response = inventory_list_api(request)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = json.loads(response.content)
        print(f"Items found: {len(data)}")
        if len(data) > 0:
            print(f"First item: {data[0]['file_name']}")
    else:
        print(f"Error: {response.content}")

if __name__ == "__main__":
    test_inventory_list()
