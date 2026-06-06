# SurveyCAD v43 PWA

PWA土台版です。

## 内容
- `manifest.json` をSurveyCAD用に整理
- `sw.js` のキャッシュ名を v43 に更新
- オフライン起動用のアプリシェルキャッシュを設定
- Android/iPhoneのホーム画面追加向けメタ情報を追加

## 注意
`file://` で開くとService Workerは基本動きません。PWA動作確認は `https://` または `http://localhost` で行ってください。
