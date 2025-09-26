import requests

url = "http://127.0.0.1:8000/send-email/"
headers = {"x-api-key": "supersecretkey123"}  # must match .env API_KEY
data = {
    "to_email": "gotvendors4u@gmail.com",
    "subject": "Secure Email Test",
    "body": "This is a secure test email!"
}

response = requests.post(url, headers=headers, params=data)
print("Status:", response.status_code)
print("Response:", response.json())
