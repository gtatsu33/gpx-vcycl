# Database Specification v4

仮想サイクリングPWA（gpx-vcycl）の Supabase スキーマ仕様。

---

## 利用者とアクセス権限

| クライアント     | 用途         | 使用キー          |
|------------------|--------------|-------------------|
| gpx-vcycl (PWA)  | SELECT | publishable key  |
| gpx-navi (PWA)   | SELECT | publishable key  |
| gpxc-editor（PWA）  | SELECT/INSERT     | publishable key  |

すべてsupabase側に登録されたE-mailアドレスだけが認証手続きが可能。


---

## Supabase PostgreSQL

### テーブル: `route_files`

Supabase Storage に格納された GPX ファイルのメタデータ。  
Storage の ASCII ファイルキーと、人間が読みやすい表示名を紐付ける。

```sql
create table route_files (
  id               bigserial primary key,
  file_key         text not null unique,  -- Storage のオブジェクトキー（拡張子含む ASCII）
  display_name     text not null unique,  -- 日本語可の表示名（重複不可）
  distance_m       numeric,              -- 総距離 [m]
  elevation_gain_m numeric,              -- 累積獲得標高 [m]
  created_at       timestamptz not null default now()
);
```

| カラム             | 制約                    | 説明                                               |
|--------------------|-------------------------|----------------------------------------------------|
| `id`               | PK, serial              | 内部ID                                             |
| `file_key`         | UNIQUE, NOT NULL        | Storage オブジェクトキー。例: `fuji-hillclimb.gpx` |
| `display_name`     | UNIQUE, NOT NULL        | UIに表示する名前。日本語可。例: `富士山ヒルクライム` |
| `distance_m`       | nullable                | 総距離 [m]。gpxconverter が GPX から計算して設定    |
| `elevation_gain_m` | nullable                | 累積獲得標高 [m]。gpxconverter が GPX から計算して設定 |
| `created_at`       | NOT NULL                | レコード作成日時                                   |

### テーブル: `workout_files`

Supabase Storage に格納された ZWO（Zwiftワークアウト形式）ファイルのメタデータ。
`route_files` と同型。ファイル本体は `gpx_routes` バケットに `.gpx` と混在で
格納する（拡張子で区別できるため、ワークアウト専用バケットは作らない）。

```sql
create table workout_files (
  id               bigserial primary key,
  file_key         text not null unique,  -- Storage のオブジェクトキー（拡張子含む ASCII、.zwo）
  display_name     text not null unique,  -- 日本語可の表示名（重複不可）
  duration_s       numeric,              -- 総時間 [秒]
  created_at       timestamptz not null default now()
);
```

| カラム             | 制約                    | 説明                                               |
|--------------------|-------------------------|----------------------------------------------------|
| `id`               | PK, serial              | 内部ID                                             |
| `file_key`         | UNIQUE, NOT NULL        | Storage オブジェクトキー。例: `sst-4x8min.zwo`     |
| `display_name`     | UNIQUE, NOT NULL        | UIに表示する名前。日本語可                          |
| `duration_s`       | nullable                | 総時間 [秒]。アップロードツールがZWOから計算して設定 |
| `created_at`       | NOT NULL                | レコード作成日時                                   |

---

## Supabase Storage

バケット名: `gpx_routes`（環境変数 `VITE_SUPABASE_BUCKET` で上書き可）

GPX・ZWO両方のファイルを同一バケットに拡張子違いで混在格納する
（`route_files`/`workout_files` の2テーブルでメタデータを分離管理するため、
Storage側でバケットを分ける必要はない）。

| 項目             | 値                                              |
|------------------|--------------------------------------------------|
| ファイル形式     | `.gpx`（XML）、`.zwo`（XML）                     |
| ファイルキー     | ASCII のみ（例: `fuji-hillclimb.gpx`, `sst-4x8min.zwo`） |
| 日本語ファイル名 | 非対応（Supabase Storage の制限）                |
| 表示名の管理     | `route_files.display_name` / `workout_files.display_name` で管理 |

---

## 書き込み仕様（gpxconverter.py）

### file_key のルール

- gpxconverter がエクスポート時に ASCII ファイル名を検証する
- 非 ASCII 文字が含まれる場合はエラーとして処理を中断する

### 重複時の挙動

- 同じ `file_key` で Storage へのアップロードまたは `route_files` への INSERT を試みた場合はエラーとする
- 同じ `display_name` で `route_files` への INSERT を試みた場合もエラーとする
- UPSERT（上書き）は行わない
- `file_key` / `display_name` の UNIQUE 制約違反は呼び出し元でハンドリングする

### INSERT 時の想定フロー

```
gpxconverter.py
  │
  ├─ route_points（メモリ上の処理済みデータ）から distance_m / elevation_gain_m を計算
  │
  ├─ GPX ファイルを生成・検証（file_key が ASCII であることを確認）
  │
  ├─ Storage.upload(file_key, gpx_bytes)
  │     重複 → エラーで中断
  │
  └─ INSERT INTO route_files (file_key, display_name, distance_m, elevation_gain_m)
        file_key 重複（UNIQUE 制約違反）→ Storage を削除してロールバック → エラーで中断
        display_name 重複（UNIQUE 制約違反）→ Storage を削除してロールバック → エラーで中断
```

---

## 書き込み仕様（ZWOアップロードツール・未実装）

gpxconverter.py と同様の役割を持つ別ツール（Zwiftワークアウトのダウンロード
フォルダとSupabase側を比較し、未アップロードの `.zwo` ファイルだけを
アップロードする想定）を今後別途作成する。仕様は `gpxconverter.py` と
対称に、以下の通りとする。

### file_key のルール

- アップロードツールがエクスポート時に ASCII ファイル名を検証する
- 非ASCII文字が含まれる場合はエラーとして処理を中断する

### 重複時の挙動

- 同じ `file_key` で Storage（`gpx_routes`バケット）へのアップロードまたは
  `workout_files` への INSERT を試みた場合はエラーとする
- 同じ `display_name` で `workout_files` への INSERT を試みた場合もエラーとする
- UPSERT（上書き）は行わない
- `file_key` / `display_name` の UNIQUE 制約違反は呼び出し元でハンドリングする
- 既にクラウド側に存在する `file_key` はスキップする（差分アップロードの本旨）

### INSERT 時の想定フロー

```
ZWOアップロードツール
  │
  ├─ ローカルのZwiftワークアウトフォルダを走査
  │
  ├─ Storage.list()（gpx_routesバケット）で既存file_key一覧を取得し、
  │     ローカルに存在してクラウドに無いファイルだけを対象に絞る
  │
  ├─ ZWOファイルをパースし duration_s を計算、file_keyがASCIIであることを確認
  │
  ├─ Storage.upload(file_key, zwo_bytes)  ※ gpx_routesバケットへ（.gpxと混在）
  │     重複 → エラーで中断（またはスキップ）
  │
  └─ INSERT INTO workout_files (file_key, display_name, duration_s)
        file_key重複（UNIQUE制約違反）→ Storageを削除してロールバック → エラーで中断
        display_name重複（UNIQUE制約違反）→ Storageを削除してロールバック → エラーで中断
```

---

## 読み取りフロー（gpx-navi）

gpx-navi はルートを IndexedDB にローカル保存して使用するナビゲーション PWA。  
Supabase からネットワーク読み込みする際のフローは以下の通り。

```
openNetworkPicker()
  │
  ├─ SELECT * FROM route_files ORDER BY created_at DESC
  │     → ルート一覧を表示（display_name, distance_m, elevation_gain_m）
  │
  ├─ ユーザーがルートを選択
  │
  ├─ Storage.download(file_key)   GPX ファイルを取得
  │
  └─ GPX をパースして IndexedDB に保存
       → ローカルルート一覧に追加（以降はローカルと同じナビ操作）
```

- ネットワーク読み込みは「追加」であり、IndexedDB の既存ルートは影響を受けない
- 同一 `file_key` のルートが既に IndexedDB に存在する場合の挙動は実装時に決定する

---

## 読み取りフロー（gpx-vcycl）

```
openRemotePicker()
  │
  ├─ Storage.list()              file_key 一覧を取得
  │
  ├─ SELECT * FROM route_files   表示名・距離・獲得標高を取得
  │     → Map<file_key, {display_name, distance_m, elevation_gain_m}>
  │
  └─ 表示
       display_name があれば使用、なければ file_key（拡張子除去）をフォールバック
       distance_m / elevation_gain_m があればサブテキストに表示
```

2回のAPIコールで完結。GPXファイル本体のダウンロードは選択後のみ。

---

## 読み取りフロー（gpx-vcycl、ワークアウト）

`route_files` と対称の読み取り専用フロー。gpx-vcyclはワークアウトの
アップロード機能を持たない（書き込みは別ツールが担当）。

```
openRemoteZwoPicker()
  │
  ├─ Storage.list()（gpx_routesバケット、.zwoのみフィルタ）
  │     file_key 一覧を取得
  │
  ├─ SELECT * FROM workout_files   表示名・総時間を取得
  │     → Map<file_key, {display_name, duration_s}>
  │
  └─ 表示
       display_name があれば使用、なければ file_key（拡張子除去）をフォールバック
       duration_s があればサブテキストに表示
```

2回のAPIコールで完結。ZWOファイル本体のダウンロードは選択後のみ。

---

## Supabase セットアップ手順

1. [Supabase ダッシュボード](https://supabase.com/dashboard) を開き、対象プロジェクトを選択
2. 左メニュー → **SQL Editor** を開く
3. 以下の SQL を貼り付けて **Run** を実行

```sql
create table route_files (
  id               bigserial primary key,
  file_key         text not null unique,
  display_name     text not null unique,
  distance_m       numeric,
  elevation_gain_m numeric,
  created_at       timestamptz not null default now()
);

alter table route_files enable row level security;

create table workout_files (
  id               bigserial primary key,
  file_key         text not null unique,
  display_name     text not null unique,
  duration_s       numeric,
  created_at       timestamptz not null default now()
);

alter table workout_files enable row level security;
```

4. 左メニュー → **Table Editor** で `route_files`・`workout_files` テーブルが
   表示されれば完了
5. 各テーブルにRLSポリシー（authenticatedロールのみSELECT許可）を設定する
   （設定方法はSupabaseダッシュボードの認証設定に準ずる。db.v4.md本書には
   ポリシーSQLの詳細は含めない）

---

## 既存テーブルへの変更（ALTER TABLE）

### ALTER TABLE とは

`CREATE TABLE` がテーブルを**新規作成**するコマンドであるのに対し、  
`ALTER TABLE` は**既存のテーブル構造を変更**するコマンドです。

今回の用途は「`display_name` カラムに UNIQUE 制約を後から追加する」ことです。

### なぜ必要か

db.v4.md を v4 として定義する前に `route_files` テーブルを既に Supabase に作成していた場合、  
そのテーブルには `display_name` の UNIQUE 制約がありません。  
Supabase の Table Editor からカラム定義を変更することもできますが、  
SQL で明示的に実行する方がトレーサビリティが高く確実です。

### Supabase での手順

1. [Supabase ダッシュボード](https://supabase.com/dashboard) を開き、対象プロジェクトを選択
2. 左メニュー → **SQL Editor** を開く
3. 以下の SQL を貼り付けて **Run** を実行

```sql
alter table route_files
  add constraint route_files_display_name_key unique (display_name);
```

4. エラーが出ずに `Success` と表示されれば完了

### 注意：既存データに重複がある場合

既に `display_name` が重複しているレコードが存在すると、上記の SQL はエラーになります。  
その場合は重複レコードを先に削除または修正してから実行してください。

```sql
-- 重複確認クエリ
select display_name, count(*)
from route_files
group by display_name
having count(*) > 1;
```

---

## Supabase Storage セットアップ

Storage バケット `gpx_routes` がまだなければ、左メニュー → **Storage** → **New bucket** で作成
- Bucket name: `gpx_routes`
- Public: オフ
