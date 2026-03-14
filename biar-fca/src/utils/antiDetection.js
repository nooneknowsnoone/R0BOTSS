"use strict";

/**
 * Anti-Detection Utilities for Facebook Bot
 * Helps avoid account bans by making bot behavior more human-like
 */

/**
 * Generate realistic random delays
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {Promise} Resolves after delay
 */
function randomDelay(min = 50, max = 200) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simulate typing for a realistic duration based on message length
 * @param {string} message - The message to be sent
 * @returns {number} Delay in milliseconds
 */
function calculateTypingTime(message) {
    if (!message) return 0;
    // Average typing speed is 40 words per minute
    // 40 wpm * 5 characters per word = 200 characters per minute
    // 200 cpm = 3.3 characters per second = 300ms per character
    const chars = message.length;
    const typingTime = chars * 150; // Using 150ms per char for a slightly faster but realistic speed
    return Math.min(typingTime, 10000); // Max 10 seconds typing time
}

/**
 * Simulate human reading time before responding
 * @param {string} receivedMessage - The message received
 * @returns {number} Delay in milliseconds
 */
function calculateReadingTime(receivedMessage) {
    if (!receivedMessage) return 1000;
    // Average reading speed is 200-250 words per minute
    // 200 wpm = 3.3 words per second = 300ms per word
    const words = receivedMessage.split(/\s+/).length;
    const baseTime = 1500; // 1.5 second base
    const readingTime = words * 250;
    return Math.min(baseTime + readingTime, 7000); // Max 7 seconds reading time
}

/**
 * Rate limiter - Helps prevent spamming
 */
class RateLimiter {
    constructor(limit = 20, interval = 60000) {
        this.limit = limit;
        this.interval = interval;
        this.timestamps = [];
    }
    
    /**
     * Check if we can send a message
     * @returns {boolean}
     */
    canSendMessage() {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < this.interval);
        return this.timestamps.length < this.limit;
    }
    
    /**
     * Record a message being sent
     */
    recordMessage() {
        this.timestamps.push(Date.now());
    }
    
    /**
     * Get suggested delay before next message if approaching limit
     * @returns {number} Delay in ms
     */
    getSuggestedDelay() {
        if (this.timestamps.length > this.limit * 0.8) {
            return 2000 + Math.random() * 3000;
        }
        return 500 + Math.random() * 500;
    }
}

/**
 * User agent rotation for less predictable behavior
 */
const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
];

/**
 * Get a random user agent
 * @returns {string}
 */
function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Behavior tracker to detect patterns
 */
class BehaviorTracker {
    constructor() {
        this.lastMessages = new Map();
    }
    
    looksLikeSpam(threadID, message) {
        const last = this.lastMessages.get(threadID);
        if (last && last.message === message && Date.now() - last.time < 5000) {
            return true;
        }
        return false;
    }
    
    recordMessage(threadID, message) {
        this.lastMessages.set(threadID, { message, time: Date.now() });
    }
    
    cleanup() {
        const now = Date.now();
        for (const [threadID, data] of this.lastMessages.entries()) {
            if (now - data.time > 3600000) {
                this.lastMessages.delete(threadID);
            }
        }
    }
}

/**
 * Activity scheduler - Simulates sleep and activity cycles
 */
class ActivityScheduler {
    constructor(options = {}) {
        this.enabled = options.enabled || false;
        this.sleepStart = options.sleepStart || 0; // 12 AM
        this.sleepEnd = options.sleepEnd || 6;     // 6 AM
    }
    
    isSleepTime() {
        if (!this.enabled) return false;
        const hour = new Date().getHours();
        if (this.sleepStart < this.sleepEnd) {
            return hour >= this.sleepStart && hour < this.sleepEnd;
        } else {
            return hour >= this.sleepStart || hour < this.sleepEnd;
        }
    }
    
    getTimeMultiplier() {
        if (this.isSleepTime()) return 2.0; // Slower responses during "sleep"
        return 1.0;
    }
}

// Export utilities
module.exports = {
    randomDelay,
    calculateTypingTime,
    calculateReadingTime,
    RateLimiter,
    getRandomUserAgent,
    BehaviorTracker,
    ActivityScheduler
};
