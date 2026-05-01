# Virtual Cycling

iPad Safari（Bluefyブラウザ）で動作するバーチャル室内サイクリングPWA。
GPXルートを読み込み、Sarisスマートトレーナーで勾配を再現しながら仮想的にコースを走るアプリ。

---

## セットアップ

```bash
npm install
npm run dev
```

起動後、ブラウザで `https://localhost:5173` を開く。
自己署名証明書の警告が出た場合は「詳細設定」→「このサイトへ進む」を選択。

---

## HTTPS が必要な理由

Web Bluetooth API は **HTTPS または `localhost`** 上でのみ動作する（ブラウザのセキュリティ要件）。

ローカル開発時は `@vitejs/plugin-basic-ssl` が自己署名証明書を自動生成するため、
`npm run dev` だけで HTTPS が有効になる。

---

## iPad（Bluefy）からのアクセス方法

1. PC と iPad を同一 Wi-Fi ネットワークに接続する
2. PC の IP アドレスを確認する

   ```
   ipconfig   # Windows
   ```

   例: `192.168.1.10`

3. Bluefy ブラウザで `https://192.168.1.10:5173` を開く
4. 自己署名証明書の警告が出たら「詳細設定」→「このサイトへ進む」を選択
5. アドレスバーの共有メニューから「ホーム画面に追加」を選ぶと PWA としてインストールされる

> iOS の設定アプリ → 一般 → VPN とデバイス管理 → 証明書を信頼 でも証明書を信頼できる。

---

## 動作確認（Phase 0 完了条件）

### 1. 基本動作

`npm run dev` → `https://localhost:5173` を開いて **「DB初期化済み」** が緑文字で表示されること。

### 2. Chrome DevTools での確認

| 確認項目 | 場所 | 期待値 |
|---|---|---|
| Manifest | Application → Manifest | エラーなし、アイコン表示 |
| Service Worker | Application → Service Workers | `sw.js` が **Activated** |
| IndexedDB | Application → Storage → IndexedDB | `virtualCycling` DB に `routes`・`rides`・`settings` ストアが存在 |

### 3. PWA インストール

iPad（Bluefy）から同一 LAN 経由でアクセスし、「ホーム画面に追加」で PWA インストールができること。

---

## スクリプト

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバ起動（HTTPS・LAN公開） |
| `npm run build` | 本番ビルド（`dist/` 出力） |
| `npm run preview` | ビルド結果のプレビュー |
| `npm test` | テスト実行 |

---

## フェーズ構成

| フェーズ | 内容 |
|---|---|
| **0（現在）** | プロジェクト基盤、PWA、IndexedDB |
| 1a | BLE接続（FTMSのみ） |
| 1b | BLE接続（CPS・HRS）+ パワーソース選択 |
| 2 | GPXルート読み込み + マップ + 勾配計算 |
| 3 | 仮想位置進行 + HUD |
| 4 | FTMS Simulation Parameters送信（負荷制御） |
| 5 | ライド記録 → FIT生成 → Strava連携 |
