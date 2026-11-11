import os

file_path = r'c:\reactjs\react-django-project\backend\users\views.py'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'UNION ALL' in line:
        start = max(0, i - 10)
        end = min(len(lines), i + 10)
        print(f"--- UNION ALL at line {i+1} ---")
        for j in range(start, end):
            print(f"{j+1}: {lines[j].strip()}")
        print("-" * 30)
