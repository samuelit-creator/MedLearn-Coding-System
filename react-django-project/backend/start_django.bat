@echo off
cd /d "c:\reactjs\react-django-project\backend"

echo Starting MedLearn backend with Waitress (16 threads)...
".\venv\Scripts\waitress-serve.exe" ^
    --host=0.0.0.0 ^
    --port=8010 ^
    --threads=16 ^
    --connection-limit=10000000000000 ^
    --channel-timeout=120 ^
    --no-log-socket-errors ^
    backend.wsgi:application
pause
