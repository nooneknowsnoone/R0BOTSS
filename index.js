const fs = require("fs");
const path = require("path");
const express = require("express");
const { spawn } = require('child_process');

// ==================== CONFIGURATION ====================
const APPSTATE_PATH = path.join(__dirname, "appstate.json");
const SETTINGS_PATH = path.join(__dirname, "settings.json");
const COMMANDS_DIR = path.join(__dirname, "cmd");
const CONFIG_DIR = path.join(__dirname, "configs");
const ADMINS_PATH = path.join(CONFIG_DIR, "admins.json");
const ACTIVE_COMMANDS_PATH = path.join(CONFIG_DIR, "active-commands.json");
const LOCAL_BIAR_FCA_PATH = path.join(__dirname, "biar-fca");

const WEB_PORT = 3000;
let botProcess = null;
let isBotRunning = false;

// Ensure configs directory exists
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Initialize config files if they don't exist
if (!fs.existsSync(ADMINS_PATH)) {
    fs.writeFileSync(ADMINS_PATH, JSON.stringify([], null, 2));
}

// ==================== EXPRESS WEB SERVER ====================
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve the control panel HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'control-panel.html'));
});

// API Routes
app.get('/api/settings', (req, res) => {
    try {
        // Read settings.json
        const settings = fs.existsSync(SETTINGS_PATH) 
            ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
            : { prefix: '/' };
        
        // Read admins
        const admins = fs.existsSync(ADMINS_PATH)
            ? JSON.parse(fs.readFileSync(ADMINS_PATH, 'utf8'))
            : [];
        
        // Read active commands
        let activeCommands = [];
        if (fs.existsSync(ACTIVE_COMMANDS_PATH)) {
            activeCommands = JSON.parse(fs.readFileSync(ACTIVE_COMMANDS_PATH, 'utf8'));
        }
        
        // Get all available commands
        let allCommands = [];
        if (fs.existsSync(COMMANDS_DIR)) {
            allCommands = fs.readdirSync(COMMANDS_DIR)
                .filter(f => f.endsWith('.js'))
                .map(f => f.replace('.js', ''));
        }
        
        // Check if appstate exists
        const hasAppstate = fs.existsSync(APPSTATE_PATH);
        
        res.json({
            prefix: settings.prefix || '/',
            admins: admins,
            activeCommands: activeCommands,
            allCommands: allCommands,
            hasAppstate: hasAppstate,
            botRunning: isBotRunning
        });
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/save-settings', (req, res) => {
    try {
        const { prefix, admins, activeCommands, appstate } = req.body;
        
        // Save prefix to settings.json
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ prefix }, null, 2));
        
        // Save admins
        fs.writeFileSync(ADMINS_PATH, JSON.stringify(admins, null, 2));
        
        // Save active commands
        fs.writeFileSync(ACTIVE_COMMANDS_PATH, JSON.stringify(activeCommands, null, 2));
        
        // Save appstate if provided
        if (appstate) {
            fs.writeFileSync(APPSTATE_PATH, JSON.stringify(appstate, null, 2));
        }
        
        res.json({ 
            success: true, 
            message: 'Settings saved successfully!' 
        });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/restart-bot', (req, res) => {
    try {
        restartBot();
        res.json({ 
            success: true, 
            message: 'Bot restart initiated!' 
        });
    } catch (error) {
        console.error('Error restarting bot:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/stop-bot', (req, res) => {
    try {
        stopBot();
        res.json({ 
            success: true, 
            message: 'Bot stopped!' 
        });
    } catch (error) {
        console.error('Error stopping bot:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/start-bot', (req, res) => {
    try {
        startBot();
        res.json({ 
            success: true, 
            message: 'Bot started!' 
        });
    } catch (error) {
        console.error('Error starting bot:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== BOT FUNCTIONS ====================
function stopBot() {
    if (botProcess) {
        botProcess.kill();
        botProcess = null;
        isBotRunning = false;
        console.log('[BOT] Bot stopped');
    }
}

function startBot() {
    if (!fs.existsSync(APPSTATE_PATH)) {
        console.log('[BOT] Cannot start: No appstate.json found');
        return false;
    }
    
    stopBot(); // Stop existing bot process
    
    // Start new bot process
    botProcess = spawn('node', [path.join(__dirname, 'bot-core.js')], {
        detached: true,
        stdio: 'pipe'
    });
    
    botProcess.stdout.on('data', (data) => {
        console.log(`[BOT] ${data.toString().trim()}`);
    });
    
    botProcess.stderr.on('data', (data) => {
        console.error(`[BOT ERROR] ${data.toString().trim()}`);
    });
    
    botProcess.on('close', (code) => {
        console.log(`[BOT] Bot process exited with code ${code}`);
        isBotRunning = false;
        botProcess = null;
    });
    
    isBotRunning = true;
    console.log('[BOT] Bot started');
    return true;
}

function restartBot() {
    console.log('[BOT] Restarting bot...');
    startBot();
}

// ==================== LOAD BIAR-FCA ====================
function loadBiarFca() {
    const candidates = [LOCAL_BIAR_FCA_PATH, "biar-fca"];
    let lastError = null;

    for (const candidate of candidates) {
        try {
            const resolvedPath = require.resolve(candidate);
            console.log(`[BOOT] Loading biar-fca from ${resolvedPath}`);
            return require(candidate);
        } catch (error) {
            lastError = error;
        }
    }

    console.error("[BOOT] Failed to load biar-fca from the local folder or node_modules.");
    throw lastError;
}

// ==================== BOT CORE FUNCTIONS ====================
function readJsonFile(filePath, label, optional = false) {
    if (!fs.existsSync(filePath)) {
        if (optional) return null;
        console.error(`[BOOT] Missing ${label} in the project root.`);
        process.exit(1);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        if (optional) return null;
        console.error(`[BOOT] ${label} is not valid JSON:`, error.message);
        process.exit(1);
    }
}

function loadSettings() {
    const settings = readJsonFile(SETTINGS_PATH, "settings.json");

    if (typeof settings.prefix !== "string" || !settings.prefix.trim()) {
        console.error("[BOOT] settings.json must contain a non-empty string prefix.");
        process.exit(1);
    }

    return settings;
}

function loadAdmins() {
    try {
        const admins = readJsonFile(ADMINS_PATH, "admins.json", true);
        return Array.isArray(admins) ? admins : [];
    } catch (error) {
        return [];
    }
}

function loadActiveCommands() {
    try {
        const activeCommands = readJsonFile(ACTIVE_COMMANDS_PATH, "active-commands.json", true);
        return Array.isArray(activeCommands) ? activeCommands : [];
    } catch (error) {
        return [];
    }
}

function readCredentials() {
    return {
        appState: readJsonFile(APPSTATE_PATH, "appstate.json"),
    };
}

function loadCommands(activeCommandsList = null) {
    if (!fs.existsSync(COMMANDS_DIR)) {
        console.error("[BOOT] Missing cmd folder.");
        process.exit(1);
    }

    const commandFiles = fs
        .readdirSync(COMMANDS_DIR)
        .filter((file) => file.endsWith(".js"))
        .sort((left, right) => left.localeCompare(right));

    if (!commandFiles.length) {
        console.error("[BOOT] No command files were found in cmd.");
        process.exit(1);
    }

    const commands = new Map();
    const loadedCommands = [];

    for (const fileName of commandFiles) {
        const commandName = path.basename(fileName, ".js").toLowerCase();
        
        // Check if command is in active list
        if (activeCommandsList && !activeCommandsList.includes(commandName)) {
            console.log(`[BOOT] Skipping disabled command: ${commandName}`);
            continue;
        }
        
        const filePath = path.join(COMMANDS_DIR, fileName);
        const commandModule = require(filePath);

        if (!commandModule || typeof commandModule.execute !== "function") {
            console.error(`[BOOT] ${fileName} must export an object with an execute function.`);
            process.exit(1);
        }

        commands.set(commandName, {
            description: commandModule.description || "",
            usage: commandModule.usage || "",
            execute: commandModule.execute,
            adminOnly: commandModule.adminOnly || false,
        });
        
        loadedCommands.push(commandName);
    }

    console.log(`[BOOT] Loaded commands: ${loadedCommands.join(", ")}`);
    return commands;
}

function sendMessageMqtt(api, message, threadID, replyToMessageID) {
    return new Promise((resolve, reject) => {
        api.sendMessageMqtt(message, threadID, replyToMessageID, (error, info) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(info);
        });
    });
}

async function sendReply(api, message, threadID, replyToMessageID) {
    if (typeof api.sendMessageMqtt === "function") {
        try {
            return await sendMessageMqtt(api, message, threadID, replyToMessageID);
        } catch (error) {
            console.error("[SEND] MQTT send failed, falling back to sendMessage:", error.message);
        }
    }
    return api.sendMessage(message, threadID, replyToMessageID);
}

function getUserInfo(api, userID) {
    return new Promise((resolve, reject) => {
        api.getUserInfo(userID, (error, data) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(data);
        });
    });
}

function isMessageEvent(event) {
    return event && (event.type === "message" || event.type === "message_reply");
}

function isAdmin(senderID, admins) {
    return admins.includes(senderID) || admins.includes(senderID.toString());
}

// Watch for config changes
function watchConfigChanges(api, commands) {
    fs.watch(CONFIG_DIR, (eventType, filename) => {
        if (filename === 'active-commands.json' && eventType === 'change') {
            console.log('[CONFIG] Active commands changed, reloading...');
            try {
                const newActiveCommands = loadActiveCommands();
                const newCommands = loadCommands(newActiveCommands);
                
                commands.clear();
                for (const [name, cmd] of newCommands) {
                    commands.set(name, cmd);
                }
                
                console.log(`[CONFIG] Commands reloaded. Active: ${[...commands.keys()].join(", ")}`);
            } catch (error) {
                console.error('[CONFIG] Failed to reload commands:', error);
            }
        }
    });
}

// ==================== START BOT CORE ====================
async function startBotCore() {
    const { login } = loadBiarFca();
    
    const settings = loadSettings();
    const admins = loadAdmins();
    const activeCommands = loadActiveCommands();
    const commands = loadCommands(activeCommands);
    const prefix = settings.prefix;

    console.log(`[BOOT] Admin UIDs: ${admins.length ? admins.join(", ") : "None set"}`);
    console.log(`[BOOT] Active commands: ${activeCommands.length ? activeCommands.join(", ") : "All commands"}`);

    const loginOptions = {
        online: false,
        updatePresence: false,
        selfListen: false,
        listenEvents: true,
        listenTyping: false,
        advancedProtection: false,
        autoMarkRead: false,
        autoMarkDelivery: false,
        autoReconnect: true,
        forceLogin: false,
        emitReady: false,
        mqttReconnectPolicy: {
            clientReconnectPeriod: 0,
            initialRetryDelay: 2000,
            maxReconnectAttempts: 10,
            maxRetryDelay: 30000,
            periodicReconnect: false,
        },
    };

    console.log("[BOOT] Starting biar-fca-bot...");
    console.log(`[BOOT] Using prefix "${prefix}" from settings.json`);
    console.log("[BOOT] Logging in to Facebook...");

    login(
        readCredentials(),
        loginOptions,
        async (error, api) => {
            if (error) {
                console.error("[LOGIN] Failed:", error);
                return;
            }

            api.setOptions({
                listenEvents: true,
                selfListen: false,
                autoMarkRead: false,
                autoMarkDelivery: false,
                autoReconnect: true,
                updatePresence: false,
                online: false,
                emitReady: false,
                advancedProtection: false,
                mqttReconnectPolicy: {
                    clientReconnectPeriod: 0,
                    initialRetryDelay: 2000,
                    maxReconnectAttempts: 10,
                    maxRetryDelay: 30000,
                    periodicReconnect: false,
                },
            });

            const botID = api.getCurrentUserID();
            console.log(`[LOGIN] Logged in successfully. Bot ID: ${botID}`);

            // Watch for config changes
            watchConfigChanges(api, commands);

            setInterval(() => {
                const stats = typeof api.getProtectionStats === "function" ? api.getProtectionStats() : null;
                const sessionId = stats?.sessionID ? stats.sessionID.slice(0, 12) : "n/a";
                console.log(`[HEARTBEAT] Bot process alive. Session: ${sessionId}`);
            }, 300000);

            try {
                const listener = await api.listenMqtt(async (listenError, event) => {
                    if (listenError) {
                        console.error("[MQTT] Listener error:", listenError);
                        return;
                    }

                    if (!isMessageEvent(event) || !event.body) {
                        return;
                    }

                    console.log(`[MQTT] ${event.senderID} -> ${event.threadID}: ${event.body}`);

                    if (!event.body.startsWith(prefix)) {
                        return;
                    }

                    const commandLine = event.body.slice(prefix.length).trim();
                    if (!commandLine) {
                        return;
                    }

                    const args = commandLine.split(/\s+/);
                    const commandName = (args.shift() || "").toLowerCase();
                    const command = commands.get(commandName);

                    if (!command) {
                        return;
                    }

                    // Check if command is admin-only
                    if (command.adminOnly) {
                        const currentAdmins = loadAdmins();
                        if (!isAdmin(event.senderID, currentAdmins)) {
                            await sendReply(
                                api,
                                "❌ This command is for admins only!",
                                event.threadID,
                                event.messageID
                            );
                            return;
                        }
                    }

                    try {
                        await command.execute({
                            api,
                            args,
                            commands,
                            event,
                            getUserInfo: (userID) => getUserInfo(api, userID),
                            prefix,
                            reply: (message, threadID = event.threadID, replyToMessageID = event.messageID) =>
                                sendReply(api, message, threadID, replyToMessageID),
                            rootDir: __dirname,
                            sendReply: (message, threadID, replyToMessageID) => sendReply(api, message, threadID, replyToMessageID),
                            settings,
                            isAdmin: (userID) => isAdmin(userID || event.senderID, loadAdmins()),
                            admins: loadAdmins(),
                        });
                    } catch (commandError) {
                        console.error(`[BOT] Command "${commandName}" failed:`, commandError);
                        await sendReply(
                            api,
                            `Command "${commandName}" failed: ${commandError.message || "Unknown error"}`,
                            event.threadID,
                            event.messageID,
                        );
                    }
                });

                if (listener && typeof listener.on === "function") {
                    listener.on("error", (listenerError) => {
                        console.error("[MQTT] Listener emitter error:", listenerError);
                    });
                }

                console.log("[MQTT] Listener started.");
            } catch (listenerError) {
                console.error("[MQTT] Failed to start listener:", listenerError);
            }
        },
    );
}

// ==================== MAIN ====================
// Parse command line arguments
const args = process.argv.slice(2);
const isWebOnly = args.includes('--web-only');
const isBotOnly = args.includes('--bot-only');

if (isBotOnly) {
    // Run only the bot
    console.log('[MODE] Running in bot-only mode');
    startBotCore();
} else if (isWebOnly) {
    // Run only the web server
    console.log('[MODE] Running in web-only mode');
    app.listen(WEB_PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log('🌐 Facebook Bot Control Panel');
        console.log('='.repeat(50));
        console.log(`📡 Server running at: http://localhost:${WEB_PORT}`);
        console.log(`📁 Config directory: ${CONFIG_DIR}`);
        console.log('='.repeat(50) + '\n');
    });
} else {
    // Run both (default)
    console.log('[MODE] Running in combined mode (web + bot)');
    
    // Start web server
    app.listen(WEB_PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log('🚀 Facebook Bot with Web Control Panel');
        console.log('='.repeat(50));
        console.log(`📡 Web panel: http://localhost:${WEB_PORT}`);
        console.log(`📁 Config directory: ${CONFIG_DIR}`);
        console.log('='.repeat(50) + '\n');
        
        // Start bot after web server
        setTimeout(() => {
            if (fs.existsSync(APPSTATE_PATH)) {
                startBotCore();
            } else {
                console.log('[BOT] Waiting for appstate.json to be uploaded via web panel...');
            }
        }, 1000);
    });
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n[SYSTEM] Shutting down...');
    stopBot();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[SYSTEM] Terminating...');
    stopBot();
    process.exit(0);
});