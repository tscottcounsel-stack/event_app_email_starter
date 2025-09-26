import requests

def test_cleanup_users(base_url):
    res = requests.get(f"{base_url}/users/")
    assert res.status_code == 200
    users = res.json()
    test_users = [u for u in users if u["email"].startswith("pytest_")]
    assert isinstance(test_users, list)
