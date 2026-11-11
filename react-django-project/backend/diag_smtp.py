import socket

candidates = [
    ('mail.medlearnvision.co.in', 465),
    ('mail.medlearnvision.co.in', 587),
    ('mail.medlearnvision.com', 465),
    ('mail.medlearnvision.com', 587),
    ('medlearnvision.coding.com', 465),
    ('medlearnvision.coding.com', 587),
    ('172.16.1.75', 465),
    ('172.16.1.75', 587),
    ('172.16.1.75', 25),
    ('172.16.0.106', 465),
    ('172.16.0.106', 587),
    ('172.16.0.106', 25),
    ('localhost', 25),
    ('localhost', 465),
    ('localhost', 587),
]

with open('smtp_diag_results.txt', 'w') as f:
    for host, port in candidates:
        try:
            f.write(f"Testing {host}:{port}...")
            s = socket.create_connection((host, port), timeout=5)
            f.write(" SUCCESS\n")
            s.close()
        except Exception as e:
            f.write(f" FAILED ({e})\n")

print("Done. Results in smtp_diag_results.txt")
