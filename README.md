# biar-fca-bot

## Installation
1. **Clone Project**:
   ```bash
   git clone https://github.com/Jubiar01/biar-fca-bot.git
   cd biar-fca-bot
   ```
2. **Install library dependencies**:
   ```bash
   cd biar-fca
   npm install
   ```
3. **Install bot dependencies**:
   ```bash
   cd ..
   npm install
   ```
4. **Configure the bot**:
   - Ensure you have an `appstate.json` file in the project root containing your Facebook cookies.
   - Edit `settings.json` to set your desired prefix.

This bot now loads commands from the `cmd` folder and calls them by file name.

## Structure

- `index.js` handles login, settings, command loading, and MQTT listening.
- `settings.json` stores the bot prefix.
- `cmd/*.js` contains each command file.

If you add `cmd/sample.js`, the command becomes `<prefix>sample`.

## Prefix

Edit `settings.json`:

```json
{
  "prefix": "/"
}
```

If you change it to `"!"`, then `ping.js` is called with `!ping`.

## Commands

Current command files:

- `cmd/echo.js`
- `cmd/help.js`
- `cmd/info.js`
- `cmd/ping.js`
- `cmd/tiktok.js`

## Run

```bash
npm start
```

## Requirements

- `appstate.json` must exist in the project root and contain valid Facebook cookies.
- The dependencies required by your copied `biar-fca` folder must still exist in `node_modules`.

Copying only the `biar-fca` source folder without its runtime dependencies is not enough to run the bot.

## Add a New Command

Create a new file inside `cmd`, for example `cmd/hello.js`:

```js
module.exports = {
  description: "Reply with hello.",
  usage: "",
  async execute({ reply }) {
    await reply("Hello!");
  },
};
```

With the default prefix, call it using `/hello`.
