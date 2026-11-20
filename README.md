# ace-test-todo-en

Node.js 組み込みモジュールのみで実装したシンプルな ToDo ウェブアプリ。

## クイックスタート

### 必要条件

- Node.js v18.0.0 以上

### サーバー起動

```bash
node server.js
```

ブラウザで http://localhost:3000 を開く。

### テスト実行

```bash
npm test
```

または直接実行:

```bash
node --test test/*.test.js
```

## API エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/todos` | 全 ToDo を取得 |
| POST | `/api/todos` | 新しい ToDo を作成 |
| PATCH | `/api/todos/:id` | 完了状態を更新 |
| DELETE | `/api/todos/:id` | ToDo を削除 |
| GET | `/` | UI ページを表示 |

## ディレクトリ構成

```
todo-app/
├── server.js    # HTTP サーバー & API ルート
├── ui.html      # シングルページ UI
├── test/        # テストスイート
│   └── helpers.js
├── package.json
└── README.md
```