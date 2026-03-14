### biar-fca-bot-v1.1 (Anti-Detection & Fingerprinting Improvements)
- **Persistent Session Identity**: Fixed a critical flaw where User-Agents were randomized per-request; the bot now maintains a consistent browser identity throughout the entire session.
- **Modernized Fingerprints**: Updated all browser signatures and versions (Chrome 134+, Firefox 134+, Safari 18.3) to match current real-world browser traffic.
- **Enhanced Header Accuracy**: Added modern technical headers including `Priority: u=0, i` and refined `Sec-CH-UA` (Client Hints) formatting to perfectly align with chosen browser versions.
- **Optional Behavioral Delays**: Refactored the advanced protection layer to make human-like timing jitter and pattern diffusion optional (disabled by default) to allow for maximum response speed.
- **Contextual Integration**: Stored `userAgentData` directly in the API context (`ctx`) to ensure consistent metadata across all HTTP and MQTT request paths.

### Command runtime
- Unified replies through a safe send helper that prefers MQTT and falls back to HTTP `sendMessage`.
- Updated built-in commands to use the shared command context and reply flow.
- Improved `help` so it lists commands from the files currently loaded by the bot.

### biar-fca integration
- Reworked `sendMessage` wrapping so callback-style usage stays compatible.

### MQTT and connection behavior
- Reduced duplicate MQTT reconnect behavior by using a single controlled reconnect path.
- Added configurable MQTT reconnect settings in the `biar-fca` options surface.
- Moved noisy MQTT payload dumps behind a debug option instead of logging them by default.

### Media and upload pipeline
- Added shared media helpers for attachment size checks, upload fallback handling, and temp-file cleanup.
- Added configurable options for `maxAttachmentBytes`, `uploadFallback`, `mediaPreprocessor`, `tempDir`, and `debug`.
- Updated both HTTP and MQTT send paths to use the same attachment preparation flow