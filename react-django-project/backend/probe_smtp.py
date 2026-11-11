import socket

hosts = ['127.0.0.1', '172.16.0.106', 'medlearnvision.com', 'mail.medlearnvision.com']
ports = [25, 465, 587]

for host in hosts:
    for port in ports:
        try:
            print(f"Checking {host}:{port}...", end=" ")
            s = socket.create_connection((host, port), timeout=2)
            print("OPEN")
            s.close()
        except Exception as e:
            print(f"CLOSED ({type(e).__name__})")
