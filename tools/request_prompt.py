import requests

response = requests.post(
    "http://127.0.0.1:8000/api/generate/prompt",
    data={"prompt": "Provide a short lab overview", "template": None},
)
print(response.status_code)
print(response.text)
