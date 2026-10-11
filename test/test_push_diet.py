import base64
import importlib.util
import json
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("push_diet", ROOT / "scripts" / "push_diet.py")
push_diet = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(push_diet)


def encode(text):
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


class FakeGitHub:
    def __init__(self, files, fail_statuses=None):
        self.files = files
        self.fail_statuses = list(fail_statuses or [])
        self.calls = []

    def request(self, method, url, token, body=None):
        self.calls.append({"method": method, "url": url, "token": token, "body": body})
        path = url.split("/contents/")[1].split("?")[0]
        if method == "GET":
            stored = self.files.get(path)
            if stored is None:
                return 404, {"message": "Not Found"}
            return 200, {"sha": stored["sha"], "content": encode(stored["text"])}
        status = self.fail_statuses.pop(0) if self.fail_statuses else 200
        if status in (409, 422):
            stored = self.files.get(path)
            if stored is not None:
                stored["sha"] = "sha-new"
            return status, {"message": "conflict"}
        text = base64.b64decode(body["content"]).decode("utf-8")
        self.files[path] = {"sha": "sha-written", "text": text}
        return status, {"content": {"sha": "sha-written"}}


class PushDietTest(unittest.TestCase):
    def setUp(self):
        self._request = push_diet.github_request

    def tearDown(self):
        push_diet.github_request = self._request

    def test_hk_today_uses_hong_kong(self):
        moment = datetime(2026, 10, 11, 16, 30, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(push_diet.hk_today(moment), "2026-10-12")

    def test_append_meal_creates_day_from_default_target_and_sums(self):
        data = {"rules": {"kcal": "keep"}, "days": []}
        meal = {
            "time": "08:00",
            "name": "早餐",
            "items": ["燕麥"],
            "kcal": 200,
            "protein": 10,
            "carbs": 30,
            "fat": 5,
        }
        push_diet.append_meal(data, "2026-10-12", meal)
        push_diet.append_meal(data, "2026-10-12", {**meal, "time": "12:00", "kcal": 170, "protein": 11, "carbs": 36, "fat": 1})
        day = data["days"][0]
        self.assertEqual(day["complete"], False)
        self.assertEqual(day["target"], {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45})
        self.assertEqual(day["intake"], {"kcal": 370, "protein": 21, "carbs": 66, "fat": 6})
        self.assertEqual(len(day["meals"]), 2)
        self.assertEqual(data["defaultTarget"], {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45})
        self.assertEqual(data["rules"]["kcal"], "keep")

    def test_existing_day_keeps_target_and_complete_flag(self):
        data = {
            "defaultTarget": {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45},
            "days": [{
                "date": "2026-10-11",
                "complete": False,
                "target": {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45},
                "intake": {"kcal": 370, "protein": 21, "carbs": 66, "fat": 2},
                "meals": [{
                    "time": "20:41",
                    "name": "晚餐",
                    "items": ["白飯"],
                    "kcal": 370,
                    "protein": 21,
                    "carbs": 66,
                    "fat": 2,
                }],
                "note": "已記晚餐",
            }],
        }
        push_diet.append_meal(data, "2026-10-11", {
            "time": "21:00",
            "name": "加餐",
            "items": [],
            "kcal": 30,
            "protein": 1,
            "carbs": 4,
            "fat": 1,
        })
        day = data["days"][0]
        self.assertEqual(day["complete"], False)
        self.assertEqual(day["note"], "已記晚餐")
        self.assertEqual(day["intake"], {"kcal": 400, "protein": 22, "carbs": 70, "fat": 3})

    def test_note_complete_and_weighin(self):
        diet = {"days": []}
        push_diet.set_note(diet, "2026-10-11", "已記晚餐")
        push_diet.set_complete(diet, "2026-10-11", True)
        self.assertEqual(diet["days"][0]["note"], "已記晚餐")
        self.assertEqual(diet["days"][0]["complete"], True)
        push_diet.set_complete(diet, "2026-10-11", False)
        self.assertEqual(diet["days"][0]["complete"], False)

        weighins = {"entries": [{"date": "2026-10-12", "weight": 54, "note": "之後"}]}
        push_diet.upsert_weighin(weighins, {
            "date": "2026-10-11",
            "weight": 54.4,
            "bodyFat": 31.8,
            "note": "起點",
        })
        push_diet.upsert_weighin(weighins, {"date": "2026-10-12", "weight": 54.1})
        self.assertEqual([item["date"] for item in weighins["entries"]], ["2026-10-11", "2026-10-12"])
        self.assertEqual(weighins["entries"][1]["note"], "之後")
        self.assertEqual(weighins["entries"][1]["weight"], 54.1)
        self.assertEqual(weighins["entries"][0]["bodyFat"], 31.8)

    def test_commit_retries_once_on_409_and_keeps_headers(self):
        original = push_diet.dumps({
            "defaultTarget": {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45},
            "days": [],
        })
        fake = FakeGitHub({"data/diet.json": {"sha": "sha-old", "text": original}}, fail_statuses=[409])
        push_diet.github_request = fake.request
        settings = {
            "token": "github_pat_test",
            "owner": "kuichingcheung",
            "repo": "Zizi-daily-tracker",
            "branch": "main",
        }
        result = push_diet.commit_json(
            settings,
            "data/diet.json",
            "更新飲食紀錄 2026-10-11",
            lambda data: push_diet.set_note(data, "2026-10-11", "備註"),
            {"days": []},
        )
        self.assertFalse(result["unchanged"])
        puts = [call for call in fake.calls if call["method"] == "PUT"]
        gets = [call for call in fake.calls if call["method"] == "GET"]
        self.assertEqual(len(gets), 2)
        self.assertEqual(len(puts), 2)
        self.assertEqual(puts[0]["body"]["sha"], "sha-old")
        self.assertEqual(puts[1]["body"]["sha"], "sha-new")
        self.assertEqual(puts[1]["body"]["branch"], "main")
        self.assertIn("ref=main", gets[0]["url"])
        self.assertNotIn("?", puts[0]["url"])
        headers = push_diet.auth_headers("github_pat_test")
        self.assertEqual(headers["Authorization"], "Bearer github_pat_test")
        self.assertEqual(headers["Accept"], "application/vnd.github+json")
        self.assertEqual(headers["X-GitHub-Api-Version"], "2022-11-28")
        self.assertEqual(headers["User-Agent"], "zizi-daily-tracker")
        written = json.loads(fake.files["data/diet.json"]["text"])
        self.assertEqual(written["days"][0]["note"], "備註")

    def test_second_422_fails(self):
        original = push_diet.dumps({"entries": []})
        fake = FakeGitHub({"data/weighins.json": {"sha": "sha-old", "text": original}}, fail_statuses=[422, 422])
        push_diet.github_request = fake.request
        with self.assertRaises(push_diet.PushError) as caught:
            push_diet.commit_json(
                {"token": "t", "owner": "o", "repo": "r", "branch": "main"},
                "data/weighins.json",
                "更新體重紀錄 2026-10-11",
                lambda data: push_diet.upsert_weighin(data, {"date": "2026-10-11", "weight": 54.4}),
                {"entries": []},
            )
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(len([call for call in fake.calls if call["method"] == "PUT"]), 2)

    def test_missing_token_does_not_use_a_placeholder(self):
        import os
        from unittest.mock import patch

        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(push_diet.PushError) as caught:
                push_diet.load_settings()
        self.assertIn("ZIZI_GITHUB_TOKEN", str(caught.exception))

    def test_unchanged_day_skips_put(self):
        data = {"days": []}
        push_diet.set_complete(data, "2026-10-11", False)
        fake = FakeGitHub({"data/diet.json": {"sha": "sha-old", "text": push_diet.dumps(data)}})
        push_diet.github_request = fake.request
        result = push_diet.commit_json(
            {"token": "t", "owner": "o", "repo": "r", "branch": "main"},
            "data/diet.json",
            "更新飲食完成狀態 2026-10-11",
            lambda current: push_diet.set_complete(current, "2026-10-11", False),
            {"days": []},
        )
        self.assertTrue(result["unchanged"])
        self.assertEqual([call["method"] for call in fake.calls], ["GET"])


if __name__ == "__main__":
    unittest.main()
