<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Clisbot logo">
</p>

<h1 align="center">Clisbot</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/longbkit/clisbot/stargazers">
    <img src="https://img.shields.io/github/stars/longbkit/clisbot?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/longbkit/clisbot/releases">
    <img src="https://img.shields.io/github/v/release/longbkit/clisbot?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://discord.gg/awGmcmFXC">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
</p>

<p align="center">仕事と私生活のための AI ワークスペースと Bot を、ひとつのアプリに。</p>

<p align="center">Clisbot に組み込まれた AI と仕事やチャットを。普段のコミュニケーションチャネルからも利用できます。</p>

<p align="center">
  <img src="https://clisbot.com/hero-mockup.png" alt="Clisbot アプリのスクリーンショット" width="100%">
</p>

<p align="center">
  <img src="https://clisbot.com/mobile-mockup.png" alt="Clisbot モバイルアプリ" width="100%">
</p>

> [!NOTE]
> GitHub Issues はバグ報告に利用してください。その他の質問はコミュニティへどうぞ。
> 質問やコミュニティでの交流は、[Clisbot Discord](https://discord.gg/awGmcmFXC) に参加してください。

---

<!-- clisbot:intro:start -->

**Claude Cowork や AI デスクトップアプリに代わる選択肢。** オフィス業務とソフトウェアエンジニアリングのためのデスクトップワークスペースです。調査、データ分析、文書作成から、ソフトウェアの計画、実装、テスト、レビューまで、会話、ファイル、コードを一か所にまとめて進められます。エージェントプロバイダーとモデルを選び、既存のサブスクリプションや API キーを使えます。

**OpenClaw や Hermes Agent に代わる選択肢。** 自分のマシンでエージェントを動かし、継続して使えるコンテキスト、再利用できるスキル、実行に必要なツールを与えられます。タスクを任せ、定期的な作業を予約し、ワークフローを自動化しながら、進捗と結果を確認できます。個人で使うことも、プロジェクト、プロバイダー、モデルへのアクセスを管理してチームで使うこともできます。

**Grok Bot、Muse、Dots に代わる選択肢。** 仕事や私生活のために、自分だけの Bot を複数作れます。それぞれの役割、ペルソナ、記憶、ツール、振る舞いを設定し、実行場所も選べます。調査、計画、開発、レビューなど、異なる専門性を持つ Bot をひとつのグループチャットに集めましょう。共通の目標を与え、アイデアの議論、タスクの調整、互いの作業のレビューを任せることで、より完成度の高い成果へと磨き上げられます。Clisbot に組み込まれたチャットで Bot と話し、普段のコミュニケーションチャネルからも AI を利用できます。ノート PC でも外出先でも使えます。

<!-- clisbot:intro:end -->

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **エージェントを自由に選択:** 40 種類以上の選択肢。Claude Code、Codex、Copilot、OpenCode、Pi の標準対応に加え、Grok を含む 38 件の ACP カタログプリセットを利用できます。Antigravity はカスタム ACP 設定で追加でき、タスクごとにモデルも選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** iOS、Android、デスクトップ、Web、CLI に対応。机で作業を始め、スマートフォンで確認し、ターミナルから自動化できます。
- **プライバシー優先:** Clisbot にはテレメトリー・トラッキング・強制ログインは一切ありません。

## コンセプト

Clisbot は、Paseo の複数デバイス向けエージェントワークスペースと、OpenClaw のチャネル連携およびチャネル固有の機能を組み合わせます。Paseo の強みは選択の自由です。タスクごとに Claude Code、Codex、Copilot、OpenCode、Pi などのエージェント実行環境とモデルを選び、仕事の変化に合わせてプロバイダーを切り替えられます。この基盤は、オフィス業務とソフトウェアエンジニアリングに使うデスクトップの AI ワークスペース、タスクの委任と自動化を担うエージェント基盤、仕事や私生活で使う Bot をひとつにまとめます。AI をアプリに組み込み、あらゆるコミュニケーションチャネルから利用できるようにすることを目指します。エージェントは Host 上で動作し、アプリやチームの会話から作業を確認・指示できます。

Clisbot は、Bot の作成とグループでの協働をアプリに組み込んでいます。専門的な役割、指示、モデルが異なる Bot をすばやく作成し、ひとつのグループに集めて、タスクの遂行、アイデア出し、互いの作業のレビューに取り組ませられます。参加者、グループ共通の指示、返信ルール、議論のラウンド数をアプリ内で直接設定し、必要に応じて議論の方向を変えたり、停止したりできます。外部のチャットアプリの画面や Bot の制約を通して協働を組み立てる場合よりも、ネイティブなグループでは Bot 同士の協働を直接コントロールできます。

業務や企業での利用に向け、Clisbot は Hub が管理する Host とアクセス制御を追加します。Member と Team への権限付与によって、利用できる Host と Project、およびエージェントが選べるプロバイダーとモデルを制限できます。管理された Host を共有しながら、利用範囲を人やチームごとに設定できます。

## 私について、このプロジェクトを作った理由

私は Long Luong（Long）、Vexere の共同創業者兼 CTO です。Vexere はベトナム第 1 位の交通予約プラットフォームであり、交通事業者向けの SaaS と販売在庫の流通基盤も構築しています。会社が 300 人、エンジニアリング・プロダクト・デザインのチームが 100 人規模へと成長する中、組織全体に AI ネイティブなワークフローを導入するための、最も実用的な方法を探してきました。

課題は、AI が役に立つかどうかではありません。分断され、高コストで、管理できない技術構成を生まずに、企業規模で AI を機能させるにはどうすればよいかです。実際には、コスト管理、ワークフローが実際の実行状況を正しく伝えること、チームにとっての利用しやすさ、ガバナンス、そして日々の仕事で使うツールやコミュニケーションの場に最先端の AI を届けることを、同時に解決する必要があります。

その結果たどり着いたのが clisbot です。新たな孤立した AI の層を作るのではなく、すでに信頼しているコーディング CLI を、継続して動作し、チャットを自然な接点とするエージェントに変えます。Slack、Telegram、Zalo などの場や、実際のチームのワークフローで利用できます。

clisbot があなたのワークフローに役立ったなら、GitHub の Star で知らせてもらえるとうれしいです。より多くの人にこのプロジェクトを知ってもらう助けにもなります。

## はじめかた

Clisbot はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・モバイルアプリ・Web アプリ・CLI などのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[clisbot.com/download](https://clisbot.com/download) または [GitHub のリリースページ](https://github.com/longbkit/clisbot/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、Settings 画面に表示される QR コードをスキャンしてください。

### CLI / ヘッドレス

CLI をインストールして Clisbot を起動します。

```bash
npm install -g @clisbot/cli
clisbot
```

ターミナルに QR コードが表示されます。どのクライアントからでも接続できます。サーバーやリモートマシンでの利用に適しています。

詳しいセットアップと設定については以下を参照してください。

- [ドキュメント](https://clisbot.com/docs)
- [設定リファレンス](https://clisbot.com/docs/configuration)

## CLI

アプリでできることはすべてターミナルからも実行できます。

```bash
clisbot run --provider claude/opus-4.6 "implement user authentication"
clisbot run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

clisbot ls                           # 実行中のエージェントを一覧表示
clisbot attach abc123                # ライブ出力をストリーミング
clisbot send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行
clisbot --host workstation.local:6868 run "run the full test suite"
```

詳細は[完全な CLI リファレンス](https://clisbot.com/docs/cli)を参照してください。

## スキル

スキルはエージェントに Clisbot を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add longbkit/clisbot
```

どのエージェントとの会話でも使用できます。

- `/clisbot-handoff` — エージェント間で作業を引き継ぎます。たとえば Claude で計画し、実装を Codex に引き継げます。
- `/clisbot-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/clisbot-committee` — 対照的な 2 つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Clisbot デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `clisbot` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: リモート接続用リレーパッケージ
- `packages/website`: マーケティングサイトとドキュメント（`clisbot.com`）

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

## スポンサー

Clisbot のスポンサー向け情報は準備中です。準備ができ次第、ここに掲載します。

<!-- Sponsor logos go here, in the same order as packages/website/src/data/sponsors.ts -->

## 出典と謝辞

- **Paseo** — [Mohamed Boudra 氏とコントリビューターによる Paseo](https://github.com/getpaseo/paseo) は、Clisbot のデーモン、エージェントセッション、クライアント、リレーモデルのソース基盤です。著作権とライセンスの表示は [LICENSE](LICENSE) に保持しています。
- **OpenClaw** — [OpenClaw とコントリビューター](https://github.com/openclaw/openclaw) は、`packages/channels/` に移植したチャネルコードの出典です。ソースの基準は各パッケージの `upstream-sync.json` に、バンドルされた依存関係の表示は [THIRD_PARTY_NOTICES](packages/hub/THIRD_PARTY_NOTICES) に記録しています。

## ライセンス

Clisbot は [Apache License 2.0](LICENSE) の下で提供されます。独自のライセンスを持つコンポーネントは除きます。

Copyright (c) 2026-present Long Luong — Clisbot に加えた変更と独自の追加部分に適用されます。

元の Paseo コード：Copyright (c) 2025-present Mohamed Boudra。上流およびサードパーティの著作権とライセンス表示は、[LICENSE](LICENSE)、各コンポーネントのライセンス、[THIRD_PARTY_NOTICES](packages/hub/THIRD_PARTY_NOTICES) に保持しています。
