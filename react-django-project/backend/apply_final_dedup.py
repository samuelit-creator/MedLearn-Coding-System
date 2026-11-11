import os

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern 1: CodingsUnion with from_date, created_at (Sheet 2 and Sheet 3)
# We look for the exact string from the last view_file output to be precise.

old_dedup_case = """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at FROM codings
            ),"""

new_dedup_case = """            CodingsUnion AS (
                SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at 
                FROM (
                    SELECT chart_id, user_id, project, subproject, project_pdf_id, from_date, created_at,
                           ROW_NUMBER() OVER(PARTITION BY chart_id ORDER BY id) as rn
                    FROM codings
                ) t WHERE rn = 1
            ),"""

content = content.replace(old_dedup_case, new_dedup_case)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Final deduplication logic applied.")
