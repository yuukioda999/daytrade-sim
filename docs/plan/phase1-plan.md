# 第1弾の plan と tasks

- 状態: 承認待ち
- 日付: 2026-11-19
- 対象: SPEC-001 から SPEC-007

## 作業の流れ

AI はクラウドの作業環境でリポジトリを clone し、タスクごとにブランチを切って実装とテストを行い、GitHub に push して PR を作る。人間は PR をレビューしてマージし、Mac で `git pull` してから `npm install` と `npm run dev` で画面を確かめる。

この流れを選ぶ理由:

- better-sqlite3 はネイティブモジュールで、インストールした OS 用にビルドされる。AI の作業環境(Linux)で入れた `node_modules` を Mac に持ち込むと動かない。`node_modules` は Mac で人間が入れる
- PR を GitHub に作れば、CI の結果と差分をブラウザで確かめられる

この流れには、AI がこのリポジトリに push できる権限が要る(権限を渡す操作は人間が承認する)。

## 使う版(2026-11-19 に npm で確認)

| 用途 | ライブラリ | 版 |
|---|---|---|
| 土台 | Next.js / React | 16.4 / 19.3 |
| 型 | TypeScript | 確認中(下の注を参照) |
| 画面 | Tailwind CSS / shadcn / Lucide React | 4.3 / 最新 / 1.76 |
| チャート | lightweight-charts / Recharts | 5.3 / 3.11 |
| 保存 | better-sqlite3 / Drizzle ORM / drizzle-kit | 13.2 / 0.45 / 0.31 |
| 入力の検査 | zod | 4.6 |
| テスト | Vitest / Playwright | 5.1 / 1.65 |
| ワーカーの起動 | tsx | 4.23 |

T1 で分かったこと(2026-11-19):

- TypeScript 7.0.2 は、型チェックとビルドは通ったが、lint(typescript-eslint)が「TS 7.0 に未対応」で止まった。5 系の最新の 5.9.3 にした
- ESLint は雛形(create-next-app 16.4.6)が入れた 9 系のまま。10 系は eslint-config-next との組み合わせを試していない
- shadcn の取得元(ui.shadcn.com)は、AI の作業環境からは通信が許可されていない。T1 では使わず、T6 の前に扱いを決める
- フォントは Google Fonts から取らず、端末のフォント(Mac ではヒラギノ)を使う。ビルド時の外部との通信を増やさないため

注:

- Node.js は 22 以上が要る(better-sqlite3 13.2 の条件)。`.nvmrc` に 22 を書く。Mac の Node.js の版は未確認
- TypeScript の最新は 7.0。Next.js 16.4 と ESLint との組み合わせで動くかを T1 で試し、動かなければ 5 系の最新に下げる。どちらにしたかを PR に書く
- shadcn の Chart コンポーネントが Recharts 3.11 に対応しているかは未確認。T6 で確かめる

## tasks

1つのタスクが1つの PR。上から順に進める。

| # | タスク | 対象の spec | 中身 | 区切り |
|---|---|---|---|---|
| T1 | 雛形 | なし | Next.js、TypeScript、Tailwind、shadcn、ESLint、Vitest、Playwright。CI が緑になる。共通のレイアウト(メニュー、免責の表示) | |
| T2 | 市場の時間 | SPEC-001 | Clock、MarketCalendar、休場日の表(2026、2027 年、NYSE の公式から写す) | |
| T3 | 買いサイン | SPEC-002 | 3つの条件の計算と判定(純粋関数) | |
| T4 | 練習売買 | SPEC-003 | 買う量、売る判定、損益、損失の上限(純粋関数) | |
| T5 | 計算の残り | SPEC-004、SPEC-005 | 成績のまとめ、シミュレーターの計算(純粋関数) | |
| T6 | シミュレーターの画面 | SPEC-005、SPEC-007 | Recharts のグラフと年次の表。localhost:3000 で動く | **区切り1** |
| T7 | 保存と設定 | SPEC-006 | SQLite と Drizzle のスキーマ、Repository、元手と為替、接続用キーの保存(security-reviewer の対象) | |
| T8 | Alpaca との接続 | SPEC-006 | データの取得、接続の確認、過去データの取得(security-reviewer の対象) | |
| T9 | ワーカー | SPEC-003、ADR-0007 | 足を受け取って判定し記録する。同じ足の二重処理を防ぐ。止まっていた間の取り直し | |
| T10 | ダッシュボードと記録の画面 | SPEC-002、SPEC-003、SPEC-007 | 監視リスト、lightweight-charts の価格チャート、今日のお金の状況、自動売買の記録 | |
| T11 | 成績の画面と過去データで試す | SPEC-004、SPEC-006 | 成績の画面、過去データで試した結果の表示 | **区切り2** |
| T12 | 仕上げ | 全体 | README、幅 390px と色の比の確認、公開の判断の材料 | |

### 区切り

- 区切り1(T1 から T6): 計算はすべてテスト済み。シミュレーターの画面が localhost:3000 で動く。Alpaca のキーは要らない
- 区切り2(T7 から T11): Alpaca のキーを入れると、ダッシュボードにデータが出て、自動の練習売買が記録される

各タスクの PR で止まり、人間のレビューとマージを待つ。

## 人間にお願いすること

- 区切り1の前: Mac の Node.js の版を確かめる(`node -v`)。22 未満なら上げる
- 区切り2の前: Alpaca の練習専用の口座(Paper Only Account)を作り、データ用のキーを発行する
