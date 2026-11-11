import socket

domains = [
    'medlearnvision.co.in',
    'medlearnvision.com',
    'medlearnvision.coding.com',
    '172.16.1.75',
    '172.16.0.106',
    'mail.medlearnvision.co.in',
    'mail.medlearnvision.com',
    'mail.medlearnvision.coding.com',
    'smtp.medlearnvision.co.in',
    'smtp.medlearnvision.com'
]

ports = [25, 465, 587]

results = []

for domain in domains:
    print(f"\n--- Checking {domain} ---")
    try:
        # Check A records
        answers = socket.getaddrinfo(domain, None)
        ips = list(set([a[4][0] for a in answers]))
        print(f"IPs: {ips}")
        
        for ip in ips:
            for port in ports:
                try:
                    print(f"  Port {port}: ", end="")
                    s = socket.create_connection((ip, port), timeout=3)
                    print("OPEN")
                    s.close()
                except Exception as e:
                    print(f"CLOSED ({type(e).__name__})")
    except Exception as e:
        print(f"Resolution failed: {e}")

print("\n--- End of report ---")
