const SOCKET_URL = "wss://ghz.indevs.in/ghz";
const KEEP_ALIVE_INTERVAL_MS = 10000;
const RECONNECT_DELAY_MS = 3000;

let sharedWebSocket = null;
let keepAliveInterval = null;
let reconnectTimeout = null;

const activeSessions = new Map();
const lastSentCache = new Map();
const favoriteMap = new Map();

function resolveWebSocketCtor() {
  if (typeof globalThis.WebSocket === "function") {
    return globalThis.WebSocket;
  }

  try {
    return require("ws");
  } catch (_error) {
    return null;
  }
}

function getOpenState(webSocketCtor, socket) {
  return socket?.OPEN ?? webSocketCtor?.OPEN ?? 1;
}

function getConnectingState(webSocketCtor, socket) {
  return socket?.CONNECTING ?? webSocketCtor?.CONNECTING ?? 0;
}

function isSocketOpen(webSocketCtor, socket) {
  return Boolean(socket && socket.readyState === getOpenState(webSocketCtor, socket));
}

function isSocketConnecting(webSocketCtor, socket) {
  return Boolean(socket && socket.readyState === getConnectingState(webSocketCtor, socket));
}

function bindSocketEvent(socket, eventName, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(eventName, handler);
    return;
  }

  if (typeof socket.on === "function") {
    socket.on(eventName, handler);
    return;
  }

  socket[`on${eventName}`] = handler;
}

function formatValue(value) {
  if (value >= 1_000_000) return `x${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `x${(value / 1_000).toFixed(1)}K`;
  return `x${value}`;
}

function getPHTime() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
}

function cleanText(text) {
  return String(text || "").trim().toLowerCase();
}

function formatItems(items) {
  return items
    .filter((item) => item.quantity > 0)
    .map((item) => `- ${item.emoji ? `${item.emoji} ` : ""}${item.name}: ${formatValue(item.quantity)}`)
    .join("\n");
}

function getSessionKey(senderID, threadID) {
  return `${senderID}:${threadID}`;
}

function clearSenderCache(senderID) {
  for (const [sessionKey, session] of activeSessions.entries()) {
    if (session.senderID === senderID) {
      lastSentCache.delete(sessionKey);
    }
  }
}

function clearSocketTimers() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

function closeSharedWebSocket() {
  clearSocketTimers();

  if (!sharedWebSocket) {
    return;
  }

  try {
    if (typeof sharedWebSocket.close === "function") {
      sharedWebSocket.close();
    }
  } catch (_error) {
    // Ignore socket shutdown errors.
  }

  sharedWebSocket = null;
}

async function sendSessionMessage(session, text) {
  if (!session || typeof session.sendReply !== "function") {
    return;
  }

  try {
    await session.sendReply(text, session.threadID);
  } catch (error) {
    console.error(`[GHZ] Failed to send update to ${session.sessionKey}:`, error.message);
  }
}

function parseSocketMessage(rawData) {
  if (rawData == null) {
    return null;
  }

  if (typeof rawData === "string") {
    return JSON.parse(rawData);
  }

  if (Buffer.isBuffer(rawData)) {
    return JSON.parse(rawData.toString("utf8"));
  }

  if (rawData.data !== undefined) {
    return parseSocketMessage(rawData.data);
  }

  return JSON.parse(String(rawData));
}

async function handleSocketPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const seeds = Array.isArray(payload.seeds) ? payload.seeds : [];
  const gear = Array.isArray(payload.gear) ? payload.gear : [];
  const weather = payload.weather || null;

  for (const [sessionKey, session] of activeSessions.entries()) {
    const favoriteList = favoriteMap.get(session.senderID) || [];
    const sections = [];
    let matchCount = 0;

    function checkItems(label, items) {
      const available = items.filter((item) => item.quantity > 0);
      if (available.length === 0) return;

      const matched = favoriteList.length > 0
        ? available.filter((item) => favoriteList.includes(cleanText(item.name)))
        : available;

      if (favoriteList.length > 0 && matched.length === 0) {
        return;
      }

      matchCount += matched.length;
      sections.push(`${label}:\n${formatItems(matched)}`);
    }

    checkItems("Seeds", seeds);
    checkItems("Gear", gear);

    if (favoriteList.length > 0 && matchCount === 0) {
      continue;
    }

    if (sections.length === 0) {
      continue;
    }

    const weatherInfo = weather
      ? `Weather: ${weather.status}\nDetails: ${weather.description}\nStart: ${weather.startTime}\nEnd: ${weather.endTime}`
      : "";

    const updatedAt = payload.lastUpdated || getPHTime().toLocaleString("en-PH");
    const title = favoriteList.length > 0
      ? `${matchCount} favorite item${matchCount > 1 ? "s" : ""} found`
      : "Garden Horizon stock";

    const message = [title, sections.join("\n\n"), weatherInfo, `Updated: ${updatedAt}`]
      .filter(Boolean)
      .join("\n\n");

    if (lastSentCache.get(sessionKey) === message) {
      continue;
    }

    lastSentCache.set(sessionKey, message);
    await sendSessionMessage(session, message);
  }
}

function scheduleReconnect() {
  if (reconnectTimeout || activeSessions.size === 0) {
    return;
  }

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    ensureWebSocketConnection();
  }, RECONNECT_DELAY_MS);
}

function ensureWebSocketConnection() {
  const WebSocketCtor = resolveWebSocketCtor();
  if (!WebSocketCtor) {
    return false;
  }

  if (isSocketOpen(WebSocketCtor, sharedWebSocket) || isSocketConnecting(WebSocketCtor, sharedWebSocket)) {
    return true;
  }

  clearSocketTimers();

  try {
    sharedWebSocket = new WebSocketCtor(SOCKET_URL);
  } catch (error) {
    console.error("[GHZ] Failed to create WebSocket:", error.message);
    scheduleReconnect();
    return false;
  }

  bindSocketEvent(sharedWebSocket, "open", () => {
    clearSocketTimers();

    keepAliveInterval = setInterval(() => {
      if (isSocketOpen(WebSocketCtor, sharedWebSocket)) {
        try {
          sharedWebSocket.send("ping");
        } catch (error) {
          console.error("[GHZ] Keep-alive failed:", error.message);
        }
      }
    }, KEEP_ALIVE_INTERVAL_MS);
  });

  bindSocketEvent(sharedWebSocket, "message", async (event) => {
    try {
      const payload = parseSocketMessage(event);
      await handleSocketPayload(payload);
    } catch (_error) {
      // Ignore malformed payloads from the remote socket.
    }
  });

  bindSocketEvent(sharedWebSocket, "close", () => {
    sharedWebSocket = null;
    clearSocketTimers();
    scheduleReconnect();
  });

  bindSocketEvent(sharedWebSocket, "error", () => {
    try {
      sharedWebSocket?.close?.();
    } catch (_error) {
      sharedWebSocket = null;
    }
  });

  return true;
}

module.exports = {
  name: "ghz",
  description: "Garden Horizon live stock tracker using WebSocket.",
  usage: "on | off | fav add Item1 | Item2 | fav remove Item1 | Item2",
  category: "Tools",
  async execute({ args, event, prefix, reply, sendReply }) {
    const senderID = String(event.senderID);
    const threadID = String(event.threadID);
    const sessionKey = getSessionKey(senderID, threadID);
    const subcommand = cleanText(args[0]);
    const commandPrefix = `${prefix}ghz`;

    if (subcommand === "fav") {
      const action = cleanText(args[1]);
      const items = args
        .slice(2)
        .join(" ")
        .split("|")
        .map((item) => cleanText(item))
        .filter(Boolean);

      if (!action || !["add", "remove"].includes(action) || items.length === 0) {
        await reply(
          [`Usage: ${commandPrefix} fav add Item1 | Item2`, `Usage: ${commandPrefix} fav remove Item1 | Item2`].join(
            "\n",
          ),
        );
        return;
      }

      const currentFavorites = new Set(favoriteMap.get(senderID) || []);
      for (const item of items) {
        if (action === "add") {
          currentFavorites.add(item);
        } else {
          currentFavorites.delete(item);
        }
      }

      const updatedFavorites = [...currentFavorites];
      favoriteMap.set(senderID, updatedFavorites);
      clearSenderCache(senderID);

      await reply(`Favorite list updated:\n${updatedFavorites.join(", ") || "(empty)"}`);
      return;
    }

    if (subcommand === "off") {
      if (!activeSessions.has(sessionKey)) {
        await reply("You do not have an active ghz session in this chat.");
        return;
      }

      activeSessions.delete(sessionKey);
      lastSentCache.delete(sessionKey);

      if (activeSessions.size === 0) {
        closeSharedWebSocket();
      }

      await reply("Garden Horizon tracking stopped.");
      return;
    }

    if (subcommand !== "on") {
      await reply(
        [
          "Garden Horizon commands:",
          `${commandPrefix} on`,
          `${commandPrefix} off`,
          `${commandPrefix} fav add Carrot | Watering Can`,
          `${commandPrefix} fav remove Carrot`,
        ].join("\n"),
      );
      return;
    }

    if (activeSessions.has(sessionKey)) {
      await reply(`You are already tracking Garden Horizon in this chat.\nUse ${commandPrefix} off to stop.`);
      return;
    }

    if (!ensureWebSocketConnection()) {
      await reply("WebSocket support is not available. Install the ws package or use a newer Node.js version.");
      return;
    }

    activeSessions.set(sessionKey, {
      senderID,
      sessionKey,
      sendReply,
      threadID,
    });

    lastSentCache.delete(sessionKey);

    await reply("Garden Horizon tracking started.");
  },
};
