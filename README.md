# Zizi

Trona 用、手機優先嘅飲食追蹤頁。純 HTML / CSS / JavaScript，唔使 build，由 GitHub Pages 用 `main` 分支根目錄托管。

Zizi 跟 Road to Cbum 同一套畫面同達標規則，但係 **Trona 自己嘅紀錄**。飲食、訓練、體重同 Kenny / Cbum 嘅數據分開，呢個 repo 唔會放入佢哋嘅真實餐單或者體重。

飲食由教練每日 commit `data/diet.json`。訓練由手機 App 經 GitHub API 寫入 `data/training.json`。體重只供顯示。日期一律用香港時間（`Asia/Hong_Kong`）嘅 `YYYY-MM-DD`。

預期網址：

`https://kuichingcheung.github.io/Zizi-daily-tracker/`

## 開 GitHub Pages

Pages 仲未開（建立網站需要 repo 管理員權限）。請喺 GitHub 做一次：

1. 打開呢個 repo → **Settings** → **Pages**
2. **Build and deployment** → Source 選 **Deploy from a branch**
3. Branch 選 **main**，資料夾選 **/ (root)**
4. Save

幾分鐘後網址會係上面條。

## 整 fine-grained token

App 要更新 `data/training.json`，需要一粒 Personal access token（fine-grained）：

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Repository access 選 **Only select repositories**，只勾 **Zizi-daily-tracker**
3. Permissions → Repository permissions → **Contents** 設做 **Read and write**（只需要呢個 repo 嘅 Contents，唔好開多其他權限）
4. Generate，複製 token
5. 用 Safari 打開上面個 Pages 網址 → **設定** → 貼上 token，repo 預設係 `kuichingcheung` / `Zizi-daily-tracker` → **儲存設定**，可以再撳 **測試連線**

Token 只會存喺部手機嘅 `localStorage`，唔會 commit 入 repo。清除瀏覽器網站資料或者撳「清除 token」就會冇咗。

有 token 時，App 會優先用 GitHub API（失敗先試 raw）讀取最新 JSON，所以儲存訓練之後唔使等 Pages 重新部署。冇 token 就讀相對路徑 `data/*.json`。

## 加到 iPhone 主畫面

1. 用 **Safari** 打開 Pages 網址（唔好用 in-app browser）
2. 撳底部分享按鈕
3. 向下搵 **加入主畫面** → **加入**
4. 之後由主畫面個 **Zizi** 圖示開，會以獨立畫面顯示，唔會帶 Safari 工具列

## 畫面

- **今日**：當日飲食攝取對比目標（熱量、蛋白質、碳水、脂肪）、餐單、教練備註，同埋訓練開關
- **紀錄**：月曆，一星期由星期日開始。飲食點：綠＝達標、紅＝未達標、灰＝進行中、淡灰＝未有紀錄；另外有青點代表有操。撳一日可以睇詳情同補返訓練
- **統計**：近 7 日同近 30 日嘅達標日數、平均攝取 / 目標、訓練日數同部位次數，加埋體重走勢
- **設定**：token、repo，同測試連線

`complete: false` 嘅日子顯示 **進行中**，唔會判達標定未達標。至少三項達標先算全日達標。

## 達標規則

同 `data/diet.json` 入面 `rules` 一致：

| 項目 | 達標 |
| --- | --- |
| 熱量 | 攝取係當日目標嘅 95%–105% |
| 蛋白質 | 攝取 ≥ 目標嘅 95%，冇上限 |
| 碳水 | 攝取 ≥ 目標嘅 95%，冇上限 |
| 脂肪 | 攝取 ≤ 目標嘅 105%，冇下限 |

每項會顯示 **差 X**（未到目標）或者 **超 X**（超過目標）。差／超係同目標數字比，唔係同門檻比；過唔過關睇上面條規則。

## 數據格式（教練）

只改 `data/diet.json` 同 `data/weighins.json`。`data/training.json` 由 App 寫。Commit 之前請先 `git pull`，避免同手機儲存撞 sha。

而家三個檔都係空陣列（保留 `rules`），等教練開始寫 Trona 嘅紀錄。

### `data/diet.json`

```json
{
  "rules": {
    "kcal": "intake between 95% and 105% of target",
    "protein": "intake >= 95% of target",
    "carbs": "intake >= 95% of target",
    "fat": "intake <= 105% of target"
  },
  "days": [
    {
      "date": "2026-10-03",
      "complete": true,
      "target": { "kcal": 1800, "protein": 100, "carbs": 200, "fat": 50 },
      "intake": { "kcal": 1760, "protein": 110, "carbs": 190, "fat": 48 },
      "meals": [
        {
          "time": "08:22",
          "name": "早餐",
          "items": "燕麥 50g、牛奶 200ml",
          "kcal": 400,
          "protein": 20,
          "carbs": 50,
          "fat": 12
        }
      ],
      "note": "熱量接近目標。"
    }
  ]
}
```

- `date`：`YYYY-MM-DD`（香港時間）
- `complete`：`false` 代表當日仲未食完，App 顯示進行中
- `target` / `intake`：`kcal`，以及 `protein`、`carbs`、`fat`（克）
- `meals`：`time`、`name`、`items`、四項營養數字
- `note`：當日備註，可留空字串
- 新一日 append 入 `days`，唔好改欄位名

上面個例子只係格式示範，唔係真實餐單。Repo 入面嘅 `days` 係空陣列。

### `data/training.json`

```json
{
  "days": [
    { "date": "2026-10-03", "trained": true, "parts": ["胸", "三頭"], "note": "推日" }
  ]
}
```

- `trained`：有冇操
- `parts`：`胸`、`背`、`肩`、`二頭`、`三頭`、`腿`、`臀`、`腹`、`帶氧`、`休息`
- `note` 可省略
- App 會按日期取代或新增當日，並保持日期排序

### `data/weighins.json`

```json
{
  "entries": [
    { "date": "2026-10-04", "weight": 55.0, "bodyFat": 22, "note": "空肚" }
  ]
}
```

- `weight` 必填（kg）
- `smm`（骨骼肌）、`bodyFat`（體脂 %）、`note` 可省略
- App 只讀，唔會改呢個檔

## 本機預覽

唔好用 `file://` 直接開，瀏覽器會擋 `fetch`。

```bash
python3 -m http.server 8080
```

然後開 `http://127.0.0.1:8080/`。

邏輯同訓練儲存（mock fetch，唔使真 token）可以用：

```bash
node --test
```
