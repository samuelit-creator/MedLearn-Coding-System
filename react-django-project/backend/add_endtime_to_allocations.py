import os
import re

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update audit_allocations part
content = content.replace(
    "SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status FROM audit_allocations",
    "SELECT chart_id, auditor_id, project, subproject, allocated_at, chart_status, end_time FROM audit_allocations"
)

# Update at_audit_allocations part
content = content.replace(
    "SELECT chart_id, at_auditor_id as auditor_id, project, subproject, allocated_at, chart_status FROM at_audit_allocations",
    "SELECT chart_id, at_auditor_id as auditor_id, project, subproject, allocated_at, chart_status, end_time FROM at_audit_allocations"
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("All Allocations CTEs updated to include end_time.")
