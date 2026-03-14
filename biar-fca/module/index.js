"use strict";

const { login } = require('../src/core/client');
const BotManager = require('../src/core/botManager');

/**
 * biar-fca - Facebook Chat API
 * 
 * A powerful Node.js library for automating Facebook Messenger interactions.
 * Provides a comprehensive API for sending messages, managing threads, retrieving user info,
 * and much more through a clean, promise-based interface.
 * 
 * @module biar-fca
 * @author NethWs3Dev (original), Jubiar (current maintainer)
 * @license MIT
 * 
 * @example Single Account
 * const { login } = require('biar-fca');
 * const fs = require('fs');
 * 
 * const appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));
 * 
 * login({ appState }, (err, api) => {
 *   if (err) return console.error(err);
 *   
 *   api.sendMessageMqtt('Hello!', 'THREAD_ID', (err, info) => {
 *     if (err) return console.error(err);
 *     console.log(`Message sent with ID: ${info.messageID}`);
 *   });
 * });
 * 
 * @example Multi-Account Support (v3.6.8+)
 * const { BotManager } = require('biar-fca');
 * 
 * const manager = new BotManager();
 * 
 * await manager.addBot('bot1', { appState: appState1 });
 * await manager.addBot('bot2', { appState: appState2 });
 * 
 * manager.on('message', ({ botId, event }) => {
 *   console.log(`Bot ${botId} received: ${event.body}`);
 * });
 * 
 * // Broadcast to all bots
 * await manager.broadcast('Hello from all accounts!', threadID);
 */

module.exports = { login, BotManager };
