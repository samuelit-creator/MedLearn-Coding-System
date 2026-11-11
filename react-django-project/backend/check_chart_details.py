import os
import django
import json
from django.db import connection

def check_chart_details(chart_id):
    results = {}
    with connection.cursor() as cursor:
        # Check dx_entries count
        cursor.execute("SELECT COUNT(*) FROM dx_entries WHERE chart_id = %s", [chart_id])
        results['dx_entries_count'] = cursor.fetchone()[0]

        # Check project_pdf_id and page_count from codings/project_pdfs
        cursor.execute("""
            SELECT c.project_pdf_id, p.page_count 
            FROM codings c 
            LEFT JOIN project_pdfs p ON p.id = c.project_pdf_id 
            WHERE c.chart_id = %s
        """, [chart_id])
        row = cursor.fetchone()
        results['project_pdf'] = {'id': row[0], 'page_count': row[1]} if row else None

        # Check if Coder has a TL
        cursor.execute("""
            SELECT u.user_employee_id, u.username, u.tl_employee_id, tl.username as tl_name
            FROM user_details u
            LEFT JOIN user_details tl ON tl.user_employee_id = u.tl_employee_id
            WHERE u.user_employee_id = (SELECT user_id FROM codings WHERE chart_id = %s)
        """, [chart_id])
        results['coder_hierarchy'] = cursor.fetchone()

    return results

if __name__ == "__main__":
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
    django.setup()
    details = check_chart_details('44189294')
    with open('chart_details_extended.json', 'w', encoding='utf-8') as f:
        json.dump(details, f, indent=4, default=str)
    print("Done")
