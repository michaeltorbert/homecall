# Changelog

## 0.3.0 — 2026-09-12

- Add four Duke backup feeds: the alternate network connection used by Varsity, WSJS, WCCG, and WTIB.
- Let listeners switch feeds explicitly, clearing the old buffer and starting at zero added delay. Same-feed reconnects retain their saved delay.
- Point connection errors toward backup choices and keep the official-player link and session logs matched to the selected feed.
- Read the displayed release version from package.json so the app and package metadata stay consistent.
