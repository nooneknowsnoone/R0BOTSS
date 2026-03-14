"use strict";

const EventEmitter = require('events');
const { login } = require('./client');
const utils = require('../utils');

/**
 * Bot Manager for Multi-Account Support
 * Manages multiple Facebook bot accounts simultaneously
 */
class BotManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.bots = new Map();
        this.globalOptions = {
            advancedProtection: true,
            autoRotateSession: true,
            randomUserAgent: true,
            updatePresence: true,
            autoMarkDelivery: true,
            autoMarkRead: true,
            ...options
        };
        
        this.stats = {
            totalBots: 0,
            activeBots: 0,
            totalMessagesReceived: 0,
            totalMessagesSent: 0,
            errors: 0,
            startTime: Date.now()
        };
    }
    
    /**
     * Add a new bot account
     * @param {string} botId - Unique identifier for this bot
     * @param {Object} credentials - Login credentials (appState or email/password)
     * @param {Object} options - Bot-specific options (overrides global options)
     * @returns {Promise<Object>} Bot instance with API
     */
    async addBot(botId, credentials, options = {}) {
        if (this.bots.has(botId)) {
            throw new Error(`Bot with ID "${botId}" already exists`);
        }
        
        const botInfo = {
            id: botId,
            status: 'connecting',
            api: null,
            credentials,
            options: { ...this.globalOptions, ...options },
            stats: {
                messagesReceived: 0,
                messagesSent: 0,
                errors: 0,
                startTime: Date.now(),
                lastActivity: Date.now()
            },
            listener: null
        };
        
        this.bots.set(botId, botInfo);
        this.stats.totalBots++;
        
        return new Promise((resolve, reject) => {
            login(credentials, botInfo.options, (err, api) => {
                if (err) {
                    botInfo.status = 'error';
                    botInfo.error = err.message;
                    this.stats.errors++;
                    this.emit('botError', { botId, error: err });
                    return reject(err);
                }
                
                botInfo.api = api;
                botInfo.status = 'online';
                botInfo.userID = api.getCurrentUserID();
                this.stats.activeBots++;
                
                // Set up message listener
                botInfo.listener = api.listenMqtt((listenErr, event) => {
                    if (listenErr) {
                        botInfo.stats.errors++;
                        this.stats.errors++;
                        this.emit('error', { botId, error: listenErr });
                        return;
                    }
                    
                    if (event && (event.type === 'message' || event.type === 'message_reply')) {
                        botInfo.stats.messagesReceived++;
                        botInfo.stats.lastActivity = Date.now();
                        this.stats.totalMessagesReceived++;
                        
                        // Emit message event with bot context
                        this.emit('message', {
                            botId,
                            bot: botInfo,
                            event
                        });
                    }
                });
                
                this.emit('botAdded', { botId, userID: botInfo.userID });
                
                utils.log(`Bot "${botId}" (${botInfo.userID}) added successfully`);
                resolve(botInfo);
            });
        });
    }
    
    /**
     * Remove a bot account
     * @param {string} botId - Bot identifier
     */
    removeBot(botId) {
        const botInfo = this.bots.get(botId);
        if (!botInfo) {
            throw new Error(`Bot with ID "${botId}" not found`);
        }
        
        // Stop listener
        if (botInfo.listener && typeof botInfo.listener.stop === 'function') {
            botInfo.listener.stop();
        }
        
        if (botInfo.status === 'online') {
            this.stats.activeBots--;
        }
        
        this.bots.delete(botId);
        this.emit('botRemoved', { botId });
        
        utils.log(`Bot "${botId}" removed`);
    }
    
    /**
     * Get bot by ID
     * @param {string} botId
     * @returns {Object|null}
     */
    getBot(botId) {
        return this.bots.get(botId) || null;
    }
    
    /**
     * Get all bots
     * @returns {Array}
     */
    getAllBots() {
        return Array.from(this.bots.values());
    }
    
    /**
     * Get bot by user ID
     * @param {string} userID
     * @returns {Object|null}
     */
    getBotByUserID(userID) {
        for (const bot of this.bots.values()) {
            if (bot.userID === userID) {
                return bot;
            }
        }
        return null;
    }
    
    /**
     * Send message from specific bot
     * @param {string} botId - Bot identifier
     * @param {string} message - Message to send
     * @param {string} threadID - Thread to send to
     * @returns {Promise}
     */
    async sendMessage(botId, message, threadID) {
        const botInfo = this.bots.get(botId);
        if (!botInfo) {
            throw new Error(`Bot with ID "${botId}" not found`);
        }
        
        if (botInfo.status !== 'online' || !botInfo.api) {
            throw new Error(`Bot "${botId}" is not online`);
        }
        
        return new Promise((resolve, reject) => {
            botInfo.api.sendMessage(message, threadID, (err, messageInfo) => {
                if (err) {
                    botInfo.stats.errors++;
                    this.stats.errors++;
                    return reject(err);
                }
                
                botInfo.stats.messagesSent++;
                botInfo.stats.lastActivity = Date.now();
                this.stats.totalMessagesSent++;
                resolve(messageInfo);
            });
        });
    }
    
    /**
     * Broadcast message to all bots
     * @param {string} message - Message to broadcast
     * @param {string} threadID - Thread to send to
     * @returns {Promise<Array>} Results from all bots
     */
    async broadcast(message, threadID) {
        const promises = [];
        
        for (const [botId, botInfo] of this.bots.entries()) {
            if (botInfo.status === 'online' && botInfo.api) {
                promises.push(
                    this.sendMessage(botId, message, threadID)
                        .then(result => ({ botId, success: true, result }))
                        .catch(error => ({ botId, success: false, error: error.message }))
                );
            }
        }
        
        return Promise.all(promises);
    }
    
    /**
     * Get manager statistics
     * @returns {Object}
     */
    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        const uptimeHours = (uptime / 3600000).toFixed(2);
        
        return {
            ...this.stats,
            uptime,
            uptimeHours,
            bots: Array.from(this.bots.entries()).map(([botId, bot]) => ({
                id: botId,
                userID: bot.userID,
                status: bot.status,
                stats: bot.stats,
                uptime: Date.now() - bot.stats.startTime
            }))
        };
    }
    
    /**
     * Get health status of all bots
     * @returns {Object}
     */
    getHealthStatus() {
        const bots = [];
        let healthy = 0;
        let unhealthy = 0;
        
        for (const [botId, bot] of this.bots.entries()) {
            const isHealthy = bot.status === 'online';
            if (isHealthy) healthy++;
            else unhealthy++;
            
            bots.push({
                id: botId,
                userID: bot.userID,
                status: bot.status,
                healthy: isHealthy,
                lastActivity: bot.stats.lastActivity,
                error: bot.error || null
            });
        }
        
        return {
            healthy,
            unhealthy,
            total: this.stats.totalBots,
            bots
        };
    }
    
    /**
     * Restart a specific bot
     * @param {string} botId
     */
    async restartBot(botId) {
        const botInfo = this.bots.get(botId);
        if (!botInfo) {
            throw new Error(`Bot with ID "${botId}" not found`);
        }
        
        const credentials = botInfo.credentials;
        const options = botInfo.options;
        
        utils.log(`Restarting bot "${botId}"...`);
        
        this.removeBot(botId);
        return this.addBot(botId, credentials, options);
    }
    
    /**
     * Restart all bots
     */
    async restartAll() {
        const botConfigs = Array.from(this.bots.entries()).map(([botId, bot]) => ({
            botId,
            credentials: bot.credentials,
            options: bot.options
        }));
        
        // Remove all bots
        for (const [botId] of this.bots.entries()) {
            this.removeBot(botId);
        }
        
        // Re-add all bots
        const results = [];
        for (const config of botConfigs) {
            try {
                const result = await this.addBot(config.botId, config.credentials, config.options);
                results.push({ botId: config.botId, success: true, result });
            } catch (error) {
                results.push({ botId: config.botId, success: false, error: error.message });
            }
        }
        
        return results;
    }
    
    /**
     * Stop all bots and clean up
     */
    stopAll() {
        utils.log("Stopping all bots...");
        
        for (const [botId] of this.bots.entries()) {
            this.removeBot(botId);
        }
        
        this.emit('allStopped');
        utils.log("All bots stopped");
    }
}

module.exports = BotManager;

