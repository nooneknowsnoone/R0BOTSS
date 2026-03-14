const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const settings = require('./settings.json');

const app = express();
const PORT = 3000;

// Store bot instances and their states
let botInstances = new Map(); // Key: adminUID, Value: { api, stopListening, prefix, adminUID, commands }

// Global commands storage
global.allCommands = new Map();
global.botInstances = botInstances; // Make accessible to commands

app.use(bodyParser.json());
app.use(express.static('public'));

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to list ALL available commands
app.get('/api/commands', async (req, res) => {
    try {
        const files = await fs.readdir('./cmd');
        const commands = [];
        
        for (const file of files) {
            if (file.endsWith('.js')) {
                const commandName = file.replace('.js', '');
                try {
                    delete require.cache[require.resolve(`./cmd/${file}`)];
                    const command = require(`./cmd/${file}`);
                    
                    global.allCommands.set(commandName, {
                        name: commandName,
                        description: command.description || 'No description',
                        usage: command.usage || '',
                        aliases: command.aliases || [],
                        adminOnly: command.adminOnly || false
                    });
                    
                    commands.push(commandName);
                } catch (cmdError) {
                    console.error(`Error reading command ${file}:`, cmdError);
                }
            }
        }
        
        res.json({ 
            success: true, 
            commands: commands,
            commandDetails: Object.fromEntries(global.allCommands)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint to start bot
app.post('/api/start-bot', async (req, res) => {
    const { appstate, adminUID, prefix = '/', selectedCommands = 'all' } = req.body;

    if (!appstate || !adminUID) {
        return res.status(400).json({ success: false, error: 'Appstate and Admin UID are required' });
    }

    try {
        // Parse and validate appstate
        const appStateArray = typeof appstate === 'string' ? JSON.parse(appstate) : appstate;

        // Stop existing bot
        if (botInstances.has(adminUID)) {
            const oldBot = botInstances.get(adminUID);
            if (oldBot.stopListening) oldBot.stopListening();
            botInstances.delete(adminUID);
        }

        // Load commands first
        const commandFiles = await fs.readdir('./cmd');
        const commands = new Map();
        const loadedCommandNames = [];
        
        for (const file of commandFiles) {
            if (file.endsWith('.js')) {
                const commandName = file.replace('.js', '');
                
                const shouldLoad = selectedCommands === 'all' || 
                    (Array.isArray(selectedCommands) && selectedCommands.includes(commandName));
                
                if (shouldLoad) {
                    try {
                        delete require.cache[require.resolve(`./cmd/${file}`)];
                        const command = require(`./cmd/${file}`);
                        
                        commands.set(commandName, {
                            execute: command.execute,
                            description: command.description,
                            usage: command.usage,
                            aliases: command.aliases || [],
                            adminOnly: command.adminOnly || false
                        });
                        
                        loadedCommandNames.push(commandName);
                        
                        // Register aliases
                        if (command.aliases && Array.isArray(command.aliases)) {
                            command.aliases.forEach(alias => {
                                commands.set(alias, {
                                    execute: command.execute,
                                    description: command.description,
                                    usage: command.usage,
                                    isAlias: true,
                                    originalCommand: commandName
                                });
                            });
                        }
                    } catch (cmdError) {
                        console.error(`Error loading command ${file}:`, cmdError);
                    }
                }
            }
        }

        // *** FIXED: Handle different login method exports ***
        let login;
        try {
            // Try different ways to import the login function
            const fcaModule = require('./biar-fca');
            
            // Check what type of export it is
            if (typeof fcaModule === 'function') {
                // Direct export (module.exports = function)
                login = fcaModule;
            } else if (fcaModule && typeof fcaModule.login === 'function') {
                // Export as object with login property
                login = fcaModule.login;
            } else if (fcaModule && typeof fcaModule.default === 'function') {
                // ES6 default export
                login = fcaModule.default;
            } else if (fcaModule && fcaModule.default && typeof fcaModule.default.login === 'function') {
                // ES6 default export with login property
                login = fcaModule.default.login;
            } else {
                throw new Error('No valid login function found in biar-fca module');
            }
        } catch (importError) {
            console.error('Failed to import biar-fca:', importError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to load Facebook API. Check if biar-fca is properly installed.' 
            });
        }

        // Attempt login
        login({ appState: appStateArray }, (err, api) => {
            if (err) {
                console.error('Login error details:', err);
                
                // Provide user-friendly error message
                let errorMessage = 'Failed to login. ';
                if (err.message?.includes('appstate')) {
                    errorMessage += 'Invalid appstate format.';
                } else if (err.message?.includes('cookies')) {
                    errorMessage += 'Cookies may be expired.';
                } else {
                    errorMessage += err.message || 'Unknown error';
                }
                
                return res.status(500).json({ 
                    success: false, 
                    error: errorMessage
                });
            }

            // Set bot options
            api.setOptions({
                listenEvents: true,
                selfListen: false,
                online: true
            });

            // Get user info
            api.getUserInfo(api.getCurrentUserID(), (err, userInfo) => {
                if (!err) {
                    console.log(`✅ Logged in as: ${userInfo[api.getCurrentUserID()]?.name || 'Unknown'}`);
                }
            });

            // Start listening
            const stopListening = api.listenMqtt(async (err, event) => {
                if (err) {
                    console.error('Listen error:', err);
                    
                    // Check if error is fatal
                    if (err.message?.includes('not logged in')) {
                        botInstances.delete(adminUID);
                    }
                    return;
                }

                try {
                    // Only process messages
                    if (event.type !== 'message') return;

                    const message = event.body;
                    if (!message || !message.startsWith(prefix)) return;

                    // Parse command
                    const args = message.slice(prefix.length).trim().split(/ +/);
                    let commandName = args.shift().toLowerCase();

                    // Check if command exists
                    if (!commands.has(commandName)) return;

                    const command = commands.get(commandName);
                    
                    // Check admin only
                    if (command.adminOnly && event.senderID !== adminUID) {
                        return api.sendMessage("❌ This command is only for bot admin!", event.threadID);
                    }

                    // Execute command
                    await command.execute({
                        api,
                        event,
                        args,
                        reply: (text) => api.sendMessage(text, event.threadID),
                        send: (text, threadID) => api.sendMessage(text, threadID || event.threadID),
                        adminUID,
                        commandName: command.isAlias ? command.originalCommand : commandName
                    });
                    
                } catch (cmdErr) {
                    console.error('Command execution error:', cmdErr);
                    api.sendMessage(`❌ Error: ${cmdErr.message}`, event.threadID);
                }
            });

            // Store bot instance
            botInstances.set(adminUID, {
                api,
                stopListening,
                prefix,
                adminUID,
                commands: loadedCommandNames,
                commandCount: loadedCommandNames.length,
                startTime: Date.now()
            });

            res.json({ 
                success: true, 
                message: `✅ Bot started with ${loadedCommandNames.length} commands. Prefix: "${prefix}"`,
                loadedCommands: loadedCommandNames
            });
        });

    } catch (error) {
        console.error('Start bot error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop bot endpoint
app.post('/api/stop-bot', (req, res) => {
    const { adminUID } = req.body;
    
    if (botInstances.has(adminUID)) {
        const bot = botInstances.get(adminUID);
        if (bot.stopListening) bot.stopListening();
        botInstances.delete(adminUID);
        res.json({ success: true, message: '⏹️ Bot stopped' });
    } else {
        res.status(404).json({ success: false, error: 'Bot not found' });
    }
});

// Status endpoint
app.get('/api/status/:adminUID', (req, res) => {
    const { adminUID } = req.params;
    const bot = botInstances.get(adminUID);
    
    if (bot) {
        const uptime = Math.floor((Date.now() - bot.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        res.json({ 
            success: true, 
            running: true, 
            prefix: bot.prefix,
            commands: bot.commands,
            commandCount: bot.commandCount,
            uptime: `${hours}h ${minutes}m`
        });
    } else {
        res.json({ success: true, running: false });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Make sure biar-fca is installed in: ${path.join(__dirname, 'biar-fca')}`);
    console.log(`⚡ Bot controller ready!\n`);
});