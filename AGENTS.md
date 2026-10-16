# Homecall local instructions

Target repository: https://github.com/michaeltorbert/homecall
GitHub App profile for Codex writes: games-codex (codex-bot-mt).
GitHub App profile for Claude writes: claude (claude-bot-mt); commits as claude-bot-mt[bot].
All GitHub writes use the appropriate App identity; never the personal account.
Implementation author marker: <!-- ai-author: codex --> for Codex-authored PRs, <!-- ai-author: claude --> for Claude-authored PRs; mixed authorship lists both. Claude-authored changes require Codex review.

Commands: npm ci; npm test; npm run build; npm start (127.0.0.1:4178).
Node.js 22.12+ required. GitHub Pages uses the static dist output.
Do not commit local recordings, transcripts, handoff packets, credentials or generated output.
Manual synchronization is the current product requirement. No camera/microphone or automatic alignment claim.
Do not call component tests or source HTTP probes real phone/browser validation.

For operator HTTP checks of public catalog endpoints, use ordinary `curl` as documented in [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md#public-catalog-checks). Preserve curl's default request identity; a denied or challenged request is evidence to report, not a reason to change clients or request identity. Runtime HTTP clients are unaffected, and local JSON parsing is allowed.
