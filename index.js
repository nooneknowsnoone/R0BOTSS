const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const login = require('./biar-fca');
const fs = require('fs').promises;
const settings = require('./settings.json');

const app = express();
const PORT = 3000;

// Store bot instances and their states
let botInstances = new Map(); // Key: adminUID, Value: { api, stopListening, prefix, adminUID, commands }

// Global commands storage for all loaded commands
global.allCommands = new Map(); // Store all available commands with their info
global.loadedCommands = new Map(); // Store currently loaded commands per bot instance

app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend from public folder

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to list ALL available commands from cmd folder
app.get('/api/commands', async (req, res) => {
    try {
        const files = await fs.readdir('./cmd');
        const commands = [];
        
        for (const file of files) {
            if (file.endsWith('.js')) {
                const commandName = file.replace('.js', '');
                try {
                    // Clear cache to get fresh command data
                    delete require.cache[require.resolve(`./cmd/${file}`)];
                    const command = require(`./cmd/${file}`);
                    
                    // Store command info globally
                    global.allCommands.set(commandName, {
                        name: commandName,
                        description: command.description || 'No description',
                        usage: command.usage || '',
                        aliases: command.aliases || [],
                        adminOnly: command.adminOnly || false,
                        filename: file
                    });
                    
                    commands.push(commandName);
                } catch (cmdError) {
                    console.error(`Error reading command ${file}:`, cmdError);
                }
            }
        }
        
        console.log('📚 Available commands:', commands);
        res.json({ 
            success: true, 
            commands: commands,
            commandDetails: Object.fromEntries(global.allCommands)
        });
    } catch (error) {
        console.error('Error loading commands:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint to start bot with appstate
app.post('/api/start-bot', async (req, res) => {
    const { appstate, adminUID, prefix = '/', selectedCommands = 'all' } = req.body;

    if (!appstate || !adminUID) {
        return res.status(400).json({ success: false, error: 'Appstate and Admin UID are required' });
    }

    try {
        // Parse and validate appstate
        const appStateArray = typeof appstate === 'string' ? JSON.parse(appstate) : appstate;

        // Stop existing bot for this admin if running
        if (botInstances.has(adminUID)) {
            const oldBot = botInstances.get(adminUID);
            if (oldBot.stopListening) oldBot.stopListening();
            botInstances.delete(adminUID);
        }

        // Load commands based on selection
        const commandFiles = await fs.readdir('./cmd');
        const commands = new Map();
        const loadedCommandNames = [];
        
        for (const file of commandFiles) {
            if (file.endsWith('.js')) {
                const commandName = file.replace('.js', '');
                
                // Check if command should be loaded
                const shouldLoad = selectedCommands === 'all' || 
                    (Array.isArray(selectedCommands) && selectedCommands.includes(commandName));
                
                if (shouldLoad) {
                    try {
                        // Clear require cache to reload fresh command
                        delete require.cache[require.resolve(`./cmd/${file}`)];
                        const command = require(`./cmd/${file}`);
                        
                        // Store command with metadata
                        commands.set(commandName, {
                            execute: command.execute,
                            description: command.description,
                            usage: command.usage,
                            aliases: command.aliases || [],
                            adminOnly: command.adminOnly || false
                        });
                        
                        loadedCommandNames.push(commandName);
                        console.log(`✅ Loaded command: ${commandName}`);
                        
                        // Also register aliases
                        if (command.aliases && Array.isArray(command.aliases)) {
                            command.aliases.forEach(alias => {
                                commands.set(alias, {
                                    execute: command.execute,
                                    description: command.description,
                                    usage: command.usage,
                                    isAlias: true,
                                    originalCommand: commandName
                                });
                                console.log(`   ↳ Alias: ${alias} -> ${commandName}`);
                            });
                        }
                    } catch (cmdError) {
                        console.error(`❌ Error loading command ${file}:`, cmdError);
                    }
                }
            }
        }

        console.log(`📦 Loaded ${commands.size} commands for admin ${adminUID}:`, loadedCommandNames);

        // Login with provided appstate
        login({ appState: appStateArray }, (err, api) => {
            if (err) {
                console.error('Login error:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to login with provided appstate. Check if cookies are valid.' 
                });
            }

            // Set bot options
            api.setOptions({
                listenEvents: true,
                selfListen: false
            });

            // Store commands in a closure for the listener
            const botCommands = commands;
            
            // Start listening
            const stopListening = api.listenMqtt(async (err, event) => {
                if (err) {
                    console.error('Listen error:', err);
                    return;
                }

                // Only process messages
                if (event.type !== 'message') return;

                const message = event.body;
                if (!message || !message.startsWith(prefix)) return;

                // Parse command
                const args = message.slice(prefix.length).trim().split(/ +/);
                let commandName = args.shift().toLowerCase();

                // Check if command exists (including aliases)
                if (!botCommands.has(commandName)) return;

                try {
                    const command = botCommands.get(commandName);
                    
                    // Check if command is admin-only
                    if (command.adminOnly && event.senderID !== adminUID) {
                        return api.sendMessage("❌ This command is only for bot admin!", event.threadID);
                    }

                    // Execute command with full context
                    await command.execute({
                        api,
                        event,
                        args,
                        reply: (text) => api.sendMessage(text, event.threadID),
                        send: (text, threadID) => api.sendMessage(text, threadID || event.threadID),
                        adminUID,
                        commandName: command.isAlias ? command.originalCommand : commandName
                    });
                    
                    console.log(`⚡ Executed command: ${commandName} by ${event.senderID}`);
                    
                } catch (cmdErr) {
                    console.error(`Error executing command ${commandName}:`, cmdErr);
                    api.sendMessage(`❌ Error executing command: ${cmdErr.message}`, event.threadID);
                }
            });

            // Store bot instance
            botInstances.set(adminUID, {
                api,
                stopListening,
                prefix,
                adminUID,
                commands: loadedCommandNames,
                commandCount: commands.size,
                startTime: Date.now()
            });

            res.json({ 
                success: true, 
                message: `✅ Bot started successfully with ${loadedCommandNames.length} commands. Prefix: "${prefix}"`,
                loadedCommands: loadedCommandNames,
                commandCount: loadedCommandNames.length
            });
        });

    } catch (error) {
        console.error('Start bot error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API endpoint to stop bot
app.post('/api/stop-bot', (req, res) => {
    const { adminUID } = req.body;
    
    if (botInstances.has(adminUID)) {
        const bot = botInstances.get(adminUID);
        if (bot.stopListening) bot.stopListening();
        botInstances.delete(adminUID);
        res.json({ success: true, message: '⏹️ Bot stopped successfully' });
    } else {
        res.status(404).json({ success: false, error: 'No running bot found for this admin' });
    }
});

// API endpoint to get bot status
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

// API endpoint to get command details
app.get('/api/command/:name', async (req, res) => {
    const { name } = req.params;
    
    try {
        const files = await fs.readdir('./cmd');
        const commandFile = files.find(f => f.replace('.js', '') === name);
        
        if (commandFile) {
            delete require.cache[require.resolve(`./cmd/${commandFile}`)];
            const command = require(`./cmd/${commandFile}`);
            
            res.json({
                success: true,
                command: {
                    name,
                    description: command.description || 'No description',
                    usage: command.usage || '',
                    aliases: command.aliases || [],
                    adminOnly: command.adminOnly || false
                }
            });
        } else {
            res.status(404).json({ success: false, error: 'Command not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Public folder: ${path.join(__dirname, 'public')}`);
    console.log(`⚡ Bot controller ready!\n`);
});