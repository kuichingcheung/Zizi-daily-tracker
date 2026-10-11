#!/usr/bin/env python3
"""Push coach updates to data/diet.json and data/weighins.json via the GitHub Contents API.

Stdlib only. Token comes from ZIZI_GITHUB_TOKEN and is never written to the repo.
"""

import argparse
import base64
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

API = "https://api.github.com"
DEFAULT_OWNER = "kuichingcheung"
DEFAULT_REPO = "Zizi-daily-tracker"
DEFAULT_BRANCH = "main"
DIET_PATH = "data/diet.json"
WEIGHINS_PATH = "data/weighins.json"
MACRO_KEYS = ("kcal", "protein", "carbs", "fat")
DEFAULT_TARGET = {"kcal": 1300, "protein": 110, "carbs": 115, "fat": 45}
HK = ZoneInfo("Asia/Hong_Kong")


class PushError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def auth_headers(token):
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "zizi-daily-tracker",
    }


def hk_today(now=None):
    current = now or datetime.now(HK)
    if current.tzinfo is None:
        current = current.replace(tzinfo=HK)
    return current.astimezone(HK).strftime("%Y-%m-%d")


def check_date(value):
    if not value or len(value) != 10 or value[4] != "-" or value[7] != "-":
        raise PushError("日期格式唔正確")
    year, month, day = value.split("-")
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        raise PushError("日期格式唔正確")
    return value


def as_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise PushError(f"{label} 唔係數字") from exc
    if not math.isfinite(number):
        raise PushError(f"{label} 唔係數字")
    if number == int(number):
        return int(number)
    return number


def dumps(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def contents_url(owner, repo, path, ref=None):
    owner_q = urllib.parse.quote(owner, safe="")
    repo_q = urllib.parse.quote(repo, safe="")
    path_q = urllib.parse.quote(path, safe="/")
    base = f"{API}/repos/{owner_q}/{repo_q}/contents/{path_q}"
    if not ref:
        return base
    query = urllib.parse.urlencode({"ref": ref, "t": str(int(time.time() * 1000))})
    return f"{base}?{query}"


def github_request(method, url, token, body=None):
    data = None
    headers = auth_headers(token)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
    if not raw:
        return status, {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        payload = {"message": raw.decode("utf-8", errors="replace")}
    return status, payload


def decode_content(payload):
    encoded = payload.get("content") or ""
    if not encoded:
        return ""
    return base64.b64decode(encoded).decode("utf-8")


def load_settings():
    token = os.environ.get("ZIZI_GITHUB_TOKEN", "").strip()
    if not token:
        raise PushError("請設定 ZIZI_GITHUB_TOKEN")
    return {
        "token": token,
        "owner": os.environ.get("ZIZI_OWNER", DEFAULT_OWNER).strip() or DEFAULT_OWNER,
        "repo": os.environ.get("ZIZI_REPO", DEFAULT_REPO).strip() or DEFAULT_REPO,
        "branch": os.environ.get("ZIZI_BRANCH", DEFAULT_BRANCH).strip() or DEFAULT_BRANCH,
    }


def target_from(data):
    raw = data.get("defaultTarget") if isinstance(data, dict) else None
    target = dict(DEFAULT_TARGET)
    if isinstance(raw, dict):
        for key in MACRO_KEYS:
            if raw.get(key) is not None:
                target[key] = as_number(raw[key], key)
    return target


def ensure_day(data, date):
    days = data.setdefault("days", [])
    if not isinstance(days, list):
        raise PushError("data/diet.json 嘅 days 唔係陣列")
    for day in days:
        if isinstance(day, dict) and day.get("date") == date:
            return day
    if not isinstance(data.get("defaultTarget"), dict):
        data["defaultTarget"] = dict(DEFAULT_TARGET)
    day = {
        "date": date,
        "complete": False,
        "target": target_from(data),
        "intake": {key: 0 for key in MACRO_KEYS},
        "meals": [],
        "note": "",
    }
    days.append(day)
    days.sort(key=lambda item: item.get("date") or "")
    return day


def recompute_intake(day):
    totals = {key: 0.0 for key in MACRO_KEYS}
    meals = day.get("meals") or []
    if not isinstance(meals, list):
        raise PushError("當日 meals 唔係陣列")
    for meal in meals:
        for key in MACRO_KEYS:
            totals[key] += float(meal.get(key) or 0)
    day["intake"] = {key: as_number(totals[key], key) for key in MACRO_KEYS}


def append_meal(data, date, meal):
    day = ensure_day(data, date)
    meals = day.setdefault("meals", [])
    if not isinstance(meals, list):
        raise PushError("當日 meals 唔係陣列")
    meals.append(meal)
    recompute_intake(day)
    return data


def set_note(data, date, text):
    day = ensure_day(data, date)
    day["note"] = text
    return data


def set_complete(data, date, complete):
    day = ensure_day(data, date)
    day["complete"] = bool(complete)
    return data


def upsert_weighin(data, entry):
    entries = data.setdefault("entries", [])
    if not isinstance(entries, list):
        raise PushError("data/weighins.json 嘅 entries 唔係陣列")
    found = None
    for item in entries:
        if isinstance(item, dict) and item.get("date") == entry["date"]:
            found = item
            break
    if found is None:
        found = {"date": entry["date"]}
        entries.append(found)
    found["weight"] = entry["weight"]
    for key in ("smm", "bodyFat"):
        if key in entry:
            found[key] = entry[key]
    if "note" in entry:
        note = str(entry["note"]).strip()
        if note:
            found["note"] = note
        else:
            found.pop("note", None)
    entries.sort(key=lambda item: item.get("date") or "")
    return data


def commit_json(settings, path, message, mutate, empty):
    """GET path, apply mutate, PUT. On 409/422, refetch and retry the write once."""
    token = settings["token"]
    owner = settings["owner"]
    repo = settings["repo"]
    branch = settings["branch"]

    def get_current():
        status, payload = github_request(
            "GET",
            contents_url(owner, repo, path, branch),
            token,
        )
        if status == 404:
            return {"sha": None, "data": json.loads(dumps(empty))}
        if status != 200:
            detail = payload.get("message") if isinstance(payload, dict) else ""
            raise PushError(detail or f"GET {status}", status)
        text = decode_content(payload)
        try:
            data = json.loads(text) if text.strip() else json.loads(dumps(empty))
        except json.JSONDecodeError as exc:
            raise PushError(f"{path} 唔係有效 JSON") from exc
        return {"sha": payload.get("sha"), "data": data}

    def put(sha, data):
        body = {
            "message": message,
            "content": base64.b64encode(dumps(data).encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            body["sha"] = sha
        return github_request("PUT", contents_url(owner, repo, path), token, body)

    current = get_current()
    before = dumps(current["data"])
    merged = mutate(current["data"])
    if before == dumps(merged):
        return {"unchanged": True, "data": merged}

    status, payload = put(current["sha"], merged)
    if status in (409, 422):
        current = get_current()
        before = dumps(current["data"])
        merged = mutate(current["data"])
        if before == dumps(merged):
            return {"unchanged": True, "data": merged}
        status, payload = put(current["sha"], merged)

    if status not in (200, 201):
        detail = payload.get("message") if isinstance(payload, dict) else ""
        raise PushError(detail or f"PUT {status}", status)
    return {"unchanged": False, "data": merged}


def build_meal(args):
    items = list(args.item or [])
    return {
        "time": args.time,
        "name": args.name,
        "items": items,
        "kcal": as_number(args.kcal, "kcal"),
        "protein": as_number(args.protein, "protein"),
        "carbs": as_number(args.carbs, "carbs"),
        "fat": as_number(args.fat, "fat"),
    }


def add_date(parser):
    parser.add_argument("--date", help="香港時間 YYYY-MM-DD，省略就用今日")


def resolve_date(args):
    return check_date(args.date or hk_today())


def cmd_meal(settings, args):
    date = resolve_date(args)
    meal = build_meal(args)
    result = commit_json(
        settings,
        DIET_PATH,
        f"更新飲食紀錄 {date}",
        lambda data: append_meal(data, date, meal),
        {"rules": {}, "defaultTarget": dict(DEFAULT_TARGET), "days": []},
    )
    return date, DIET_PATH, result


def cmd_note(settings, args):
    date = resolve_date(args)
    text = args.text
    result = commit_json(
        settings,
        DIET_PATH,
        f"更新飲食備註 {date}",
        lambda data: set_note(data, date, text),
        {"rules": {}, "defaultTarget": dict(DEFAULT_TARGET), "days": []},
    )
    return date, DIET_PATH, result


def cmd_complete(settings, args, complete):
    date = resolve_date(args)
    result = commit_json(
        settings,
        DIET_PATH,
        f"更新飲食完成狀態 {date}",
        lambda data: set_complete(data, date, complete),
        {"rules": {}, "defaultTarget": dict(DEFAULT_TARGET), "days": []},
    )
    return date, DIET_PATH, result


def cmd_weighin(settings, args):
    date = resolve_date(args)
    entry = {"date": date, "weight": as_number(args.weight, "weight")}
    if args.body_fat is not None:
        entry["bodyFat"] = as_number(args.body_fat, "bodyFat")
    if args.smm is not None:
        entry["smm"] = as_number(args.smm, "smm")
    if args.note is not None:
        entry["note"] = args.note
    result = commit_json(
        settings,
        WEIGHINS_PATH,
        f"更新體重紀錄 {date}",
        lambda data: upsert_weighin(data, entry),
        {"entries": []},
    )
    return date, WEIGHINS_PATH, result


def build_parser():
    parser = argparse.ArgumentParser(description="用 GitHub API 推送 Zizi 飲食同體重")
    sub = parser.add_subparsers(dest="command", required=True)

    meal = sub.add_parser("meal", help="加一餐，並用全部餐單重計當日 intake")
    add_date(meal)
    meal.add_argument("--time", required=True, help="例如 20:41")
    meal.add_argument("--name", required=True, help="例如 晚餐")
    meal.add_argument("--item", action="append", default=[], help="可重複，食材一行一個")
    meal.add_argument("--kcal", required=True, type=float)
    meal.add_argument("--protein", required=True, type=float)
    meal.add_argument("--carbs", required=True, type=float)
    meal.add_argument("--fat", required=True, type=float)

    note = sub.add_parser("note", help="設定當日備註")
    add_date(note)
    note.add_argument("--text", required=True)

    complete = sub.add_parser("complete", help="當日飲食標成已完成")
    add_date(complete)

    incomplete = sub.add_parser("incomplete", help="當日飲食標成進行中")
    add_date(incomplete)

    weighin = sub.add_parser("weighin", help="新增或更新當日體重")
    add_date(weighin)
    weighin.add_argument("--weight", required=True, type=float, help="kg")
    weighin.add_argument("--body-fat", type=float, help="體脂 %")
    weighin.add_argument("--smm", type=float, help="骨骼肌")
    weighin.add_argument("--note", help="可省略；空字串會清走舊備註")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        settings = load_settings()
        if args.command == "meal":
            date, path, result = cmd_meal(settings, args)
        elif args.command == "note":
            date, path, result = cmd_note(settings, args)
        elif args.command == "complete":
            date, path, result = cmd_complete(settings, args, True)
        elif args.command == "incomplete":
            date, path, result = cmd_complete(settings, args, False)
        elif args.command == "weighin":
            date, path, result = cmd_weighin(settings, args)
        else:
            parser.error("未知指令")
            return 2
    except PushError as error:
        print(str(error), file=sys.stderr)
        return 1
    if result["unchanged"]:
        print(f"{path} {date} 冇改動")
    else:
        print(f"已更新 {path} {date}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
