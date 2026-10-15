# CUA context profile

[English](README.md) | 日本語

Codexデスクトップアプリに同梱されたComputer Use（CUA）の説明を、必要に応じて読み込むための実験的なアダプターです。
最初に短い操作ガイドを表示し、アプリやブラウザを使い始めると、その操作に必要な詳細説明を追加します。
OpenAIの公式プラグインではありません。

## 対応範囲

操作対象のコンピューターが公開する `cua.computer.target` と、有効な機能から説明を選びます。
macOS、Windows、Linuxを区別し、JavaScriptを実行する端末のOSから操作対象のOSを推測しません。
ブラウザのみの構成にも対応します。
対象や説明文の構造を判定できない場合は、元の全文を使用します。

インストーラーはmacOSとWindowsに対応しています。
Linux向けインストーラーはありません。
OSごとの分岐はテスト用データで検証し、Windowsでは起動ラッパーと同梱説明の互換性も検証しています。
これらのテストだけでは、デスクトップアプリが実際にアダプターを選択したことや、GUI操作の互換性までは確認できません。

このリポジトリには、独自に作成したコードとテストをMITライセンスで収録しています。
OpenAIの実行ファイル、パッケージ、説明文、個人設定、認証情報は収録していません。
利用には、CUAに対応するCodexデスクトップアプリ（配布名が `ChatGPT.app` の版を含む）と、そのアプリに必要な権限が必要です。

## macOSへのインストール

Python 3と、CUAに対応するアプリを用意し、このリポジトリのディレクトリで実行します。
準備処理は、インストール済みのCUAパッケージをアプリ本体の外へコピーして説明アダプターを適用します。
署名付きアプリ本体は変更しません。

```sh
python3 install.py --app /Applications/Codex.app
# 配布名が異なる場合は /Applications/ChatGPT.app を指定
python3 activate.py
```

`--app` を省略すると、システムとユーザーのApplicationsディレクトリから候補を探します。
標準の配置先は `~/.codex/cua-context-profile` です。
配置先を変える場合は、準備と有効化の両方に同じ `--dest PATH` を指定してください。

有効化後はデスクトップアプリを終了して開き直してください。
設定は現在のログインセッションで有効です。
再ログイン後は再度有効化します。
常駐プロセスは追加しません。

元の設定へ戻すには、次を実行します。

```sh
python3 activate.py --restore
```

## Windowsへのインストール

Python 3、CUAに対応するアプリ、Windowsの.NET Frameworkコンパイラー（`Framework64/v4.0.30319/csc.exe`）が必要です。
起動ラッパーはWindows上でコンパイルします。

このリポジトリのディレクトリでPowerShellを開き、`resources/cua_node/bin/node_modules/@oai/cua` を含むアプリのディレクトリを指定します。
次の `C:\path\to\installed\app` は実際の配置先に置き換えてください。

```powershell
python install_windows.py --app 'C:\path\to\installed\app'
python test_windows_wrapper.py
python activate_windows.py
```

準備処理は同梱説明の互換性を検証してからコピーし、有効化は別のコマンドで行います。
標準の配置先は `%USERPROFILE%\.codex\cua-context-profile` です。
準備と有効化には `--dest PATH` も指定できます。
既存の配置先や別の上書き設定は保護されます。

有効化はユーザー環境変数 `CODEX_NODE_REPL_PATH` を設定し、環境変更を通知します。
Explorerへ通知が届くよう、ログイン中のWindowsセッションで実行してください。
設定は再ログイン後も保持されます。
Codexを終了して開き直すと反映されますが、起動元の古いターミナルが以前の環境を保持している場合は、新しいターミナルを開くか再ログインしてください。

元の設定へ戻すには、次を実行します。
復元用スクリプトはインストール先にも配置されます。

```powershell
python activate_windows.py --restore
```

## 説明を読み込むタイミング

- `getApp()`：対象OSのネイティブアプリ用説明を追加します。
- `getBrowser()`、`getTab()`、`createBrowserTab()`：ブラウザ用説明を追加します。
- `cua.documentation("native" | "browser" | "full")`：説明を明示的に取得します。
- `cua.rewriteDocumentation()`：元の処理に加え、使用済みの機能の説明を再表示します。

同じ機能と実行環境の説明は重複表示を抑え、並行した呼び出しでも共有します。
詳細説明は対象への接続前に表示するため、説明の取得失敗を理由にアプリ起動などを再実行することを避けられます。
ブラウザ提供元が返す固有の説明は、そのまま使用します。
上記の拡張APIは、このアダプターが読み込まれた場合に利用できます。

機能の判定だけを目的としたアプリ一覧の取得、アプリの起動、ブラウザへの接続は行いません。
承認、入力、IPC、権限、操作の終了処理も変更しません。
カーソルの残留や複数の操作者の競合を解決する機能はありません。

対応する外部MCPランチャーから使う場合は、`CUA_REPL_NODE_REPL_PATH` にインストール済みのラッパー（macOSでは `node-repl`、Windowsでは `node-repl.exe`）を指定します。
[Claude向けブリッジ](https://github.com/ksmkzs/claude-cua-mcp/blob/main/README.ja.md)は、このプロファイルを任意で利用できます。
ブリッジ自体のインストーラーはmacOS専用です。

## 更新時の動作

起動ラッパーは、準備時に記録した元ファイルとメタデータのハッシュを検証します。
変更を検出すると説明アダプターを無効にし、標準ランタイムを使用します。
Windowsでは、デスクトップアプリが渡すNodeのパスから現在の標準ランタイムを選び、Store更新による配置先の変更にも対応します。

更新後の再インストールでは、上流の説明や仕様の変更を確認してください。
ハッシュを更新しただけでは意味的な互換性を確認できません。

## テスト

Node.js、npm、Python 3を使います。
通常のテストは自作の説明データと一時ディレクトリを利用します。

```sh
npm test
python3 -m unittest discover -s tests
```

Windowsの起動ラッパーは、Windows上で次を実行して検証します。

```powershell
python test_windows_wrapper.py
```

インストール済みの説明を使う任意の検証例です。
ファイルを外部へ送信する処理はありません。

```sh
CUA_PACKAGE=/path/to/cua_node/lib/node_modules/@oai/cua node test_profile.mjs
```

新しいCUAセッションでも、実際に返された説明を確認してください。
テスト結果から、トークン数や料金の削減量を推定することはできません。

## 更新検知のDraft PR

GitHub Actionsが公開版デスクトップアプリのappcastを6時間ごとに確認します。
手動実行も可能です。
新版を検出すると、オフラインテストの成功後に `upstream/observed.json` を更新するDraft PRを作成または更新します。
変化がなければコミットやPRを増やしません。

このPRは互換性をレビューするための更新通知です。
互換性の修正、実機検証、ローカルのハッシュ更新、有効化は自動化していません。
公開フィードは、アカウントごとの配信やベータ版と異なる場合があります。

リポジトリのActions設定で、GitHub ActionsによるPR作成を許可してください。
認証にはリポジトリの `GITHUB_TOKEN` を使い、個人トークンやOpenAI APIキーは必要ありません。
スケジュール実行にはGitHub側の遅延や無活動時の停止があり、即時検知を保証するものではありません。

参考：[Codexの変更履歴](https://learn.chatgpt.com/docs/changelog)、[公開appcast](https://persistent.oaistatic.com/codex-app-prod/appcast.xml)、[GitHub Actionsの権限設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)。
