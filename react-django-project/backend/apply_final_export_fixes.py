import os

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update ErrorUnion in export_team_quality_api (all occurrences)
# Adding row_id to the SELECT lists
content = content.replace(
    "SELECT chart_id, error_type, error_count, error_command FROM audit_errors",
    "SELECT chart_id, error_type, error_count, error_command, row_id FROM audit_errors"
)
content = content.replace(
    "SELECT chart_id, error_type, error_count, error_command FROM at_audit_errors",
    "SELECT chart_id, error_type, error_count, error_command, row_id FROM at_audit_errors"
)

# 2. Update DXUnion in export_team_quality_api (Sheet 3: Error Log)
# We need to add dx_location specifically to the DXUnion in the error_sql block.
# Since DXUnion appears in multiple places, I'll target the one in Sheet 3.

old_dx_union_error = """            DXUnion AS (
                SELECT id, chart_id, from_date, dxcode, CAST(NULL AS DATETIME) as created_at FROM audit_dx_entries
                UNION ALL
                SELECT id, chart_id, from_date, dxcode, created_at FROM at_audit_dx_entries
            ),"""

new_dx_union_error = """            DXUnion AS (
                SELECT id, chart_id, from_date, dxcode, dx_location, CAST(NULL AS DATETIME) as created_at FROM audit_dx_entries
                UNION ALL
                SELECT id, chart_id, from_date, dxcode, dx_location, created_at FROM at_audit_dx_entries
            ),"""

# Using replace once. Note that Sheet 2 also has a similar DXUnion but WITHOUT dx_location.
# I will only replace the one that matches exactly (with CAST(NULL AS DATETIME)).
content = content.replace(old_dx_union_error, new_dx_union_error)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Final export columns (row_id, dx_location) added.")
