# Changelog

## 0.4.0 — 2026-09-19

- Add the Sync tab: choose a school's game broadcast, find a recorded play by the clock on your TV, confirm it, and fine-tune by ear (#8).
- Keep provider stream addresses out of the site and out of browser traffic. Radio, recordings and game streams now reach the browser through the Homecall gateway, which stores the addresses privately and relays the audio (#11, #12).
- Serve live game streams through per-broadcast capabilities so a playlist reload costs the same as it does from the provider, and let one capability last a whole game.
- Fix Miami's intermittent connection failures and Virginia Tech recordings failing on their first request.
- Keep live radio playing while you look at the Sync or Archive tabs; starting a recording or a game stream still stops it (#13, #14).

## 0.3.0 — 2026-09-12

- Add four Duke backup feeds: the alternate network connection used by Varsity, WSJS, WCCG, and WTIB.
- Let listeners switch feeds explicitly, clearing the old buffer and starting at zero added delay. Same-feed reconnects retain their saved delay.
- Point connection errors toward backup choices and keep the official-player link and session logs matched to the selected feed.
- Read the displayed release version from package.json so the app and package metadata stay consistent.
