# 대여 동작 테스트 (반납/연장 포함)


def test_list_assets(client):
    res = client.get("/assets")
    assert res.status_code == 200
    body = res.json()
    assert len(body) >= 2
    assert body[0]["name"]


def test_create_rental_requires_auth(client):
    res = client.post("/rentals", json={"asset_id": 1})
    assert res.status_code == 401


def test_create_rental_success(client):
    res = client.post("/rentals", json={"asset_id": 1}, headers={"X-User-Id": "alice"})
    assert res.status_code == 201
    body = res.json()
    assert body["asset_id"] == 1
    assert body["user_id"] == "alice"
    assert body["returned_at"] is None


def test_create_rental_double_rent_blocked(client):
    headers = {"X-User-Id": "alice"}
    res1 = client.post("/rentals", json={"asset_id": 1}, headers=headers)
    assert res1.status_code == 201

    res2 = client.post("/rentals", json={"asset_id": 1}, headers={"X-User-Id": "bob"})
    assert res2.status_code == 400
    assert res2.json()["detail"] == "asset_already_rented"


def test_create_rental_maintenance_blocked(client):
    res = client.post("/rentals", json={"asset_id": 3}, headers={"X-User-Id": "alice"})
    assert res.status_code == 400
    assert res.json()["detail"] == "asset_not_available"


def test_list_my_rentals(client):
    client.post("/rentals", json={"asset_id": 1}, headers={"X-User-Id": "alice"})
    res = client.get("/rentals/mine", headers={"X-User-Id": "alice"})
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["user_id"] == "alice"


def test_return_rental_success(client):
    create_res = client.post("/rentals", json={"asset_id": 1}, headers={"X-User-Id": "alice"})
    rental_id = create_res.json()["id"]

    res = client.patch(f"/rentals/{rental_id}/return", headers={"X-User-Id": "alice"})
    assert res.status_code == 200
    assert res.json()["returned_at"] is not None


def test_extend_rental_success(client):
    create_res = client.post("/rentals", json={"asset_id": 1}, headers={"X-User-Id": "alice"})
    rental_id = create_res.json()["id"]

    res = client.patch(
        f"/rentals/{rental_id}/extend",
        json={"extra_days": 3},
        headers={"X-User-Id": "alice"},
    )
    assert res.status_code == 200
