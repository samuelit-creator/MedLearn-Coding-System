import os
import django
from django.conf import settings
from django.core.mail import send_mail

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

try:
    print("Attempting to send test email...")
    send_mail(
        'Test SMTP',
        'This is a test email to verify SMTP settings.',
        settings.DEFAULT_FROM_EMAIL,
        [settings.DEFAULT_FROM_EMAIL],
        fail_silently=False,
    )
    print("Success: Email sent successfully!")
except Exception as e:
    print(f"Failure: {str(e)}")
    import traceback
    traceback.print_exc()
