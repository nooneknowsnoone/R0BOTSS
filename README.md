# biar-fca-bot

This bot now loads commands from the `cmd` folder and calls them by file name.

## Structure

- `index.js` handles login, settings, command loading, and MQTT listening.
- `settings.json` stores the bot prefix.
- `cmd/*.js` contains each command file.
- `biar-fca/` is your copied local Messenger library.

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
