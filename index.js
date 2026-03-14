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

app.use(bodyParser.json());
app.use(express.static('public')); // Serve frontend from public folder

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to list available commands
app.get('/api/commands', async (req, res) => {
    try {
        const files = await fs.readdir('./cmd');
        const commands = files
            .filter(f => f.endsWith('.js'))
            .map(f => f.replace('.js', ''));
        res.json({ success: true, commands });
    } catch (error) {
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
        const validCommandFiles = [];
        
        for (const file of commandFiles) {
            if (file.endsWith('.js')) {
                const commandName = file.replace('.js', '');
                // Check if command should be loaded
                if (selectedCommands === 'all' || 
                    (Array.isArray(selectedCommands) && selectedCommands.includes(commandName))) {
                    try {
                        // Clear require cache to reload fresh command
                        delete require.cache[require.resolve(`./cmd/${file}`)];
                        const command = require(`./cmd/${file}`);
                        commands.set(commandName, command);
                        validCommandFiles.push(commandName);
                        console.log(`Loaded command: ${commandName}`);
                    } catch (cmdError) {
                        console.error(`Error loading command ${file}:`, cmdError);
                    }
                }
            }
        }

        console.log(`Loading ${commands.size} commands for admin ${adminUID}:`, validCommandFiles);

        // Login with provided appstate
        login({ appState: appStateArray }, (err, api) => {
            if (err) {
                console.error('Login error:', err);
                return res.status(500).json({ success: false, error: 'Failed to login with provided appstate' });
            }

            // Set bot options
            api.setOptions({
                listenEvents: true,
                selfListen: false
            });

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
                const commandName = args.shift().toLowerCase();

                // Check if command exists
                if (!commands.has(commandName)) return;

                try {
                    const command = commands.get(commandName);
                    
                    // Execute command with context
                    await command.execute({
                        api,
                        event,
                        args,
                        reply: (text) => api.sendMessage(text, event.threadID),
                        send: (text, threadID) => api.sendMessage(text, threadID || event.threadID),
                        adminUID
                    });
                } catch (cmdErr) {
                    console.error(`Error executing command ${commandName}:`, cmdErr);
                    api.sendMessage(`Error executing command: ${cmdErr.message}`, event.threadID);
                }
            });

            // Store bot instance
            botInstances.set(adminUID, {
                api,
                stopListening,
                prefix,
                adminUID,
                commands: Array.from(commands.keys())
            });

            res.json({ 
                success: true, 
                message: `Bot started successfully with ${commands.size} commands. Prefix: "${prefix}"`,
                loadedCommands: Array.from(commands.keys())
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
        res.json({ success: true, message: 'Bot stopped successfully' });
    } else {
        res.status(404).json({ success: false, error: 'No running bot found for this admin' });
    }
});

// API endpoint to get bot status
app.get('/api/status/:adminUID', (req, res) => {
    const { adminUID } = req.params;
    const bot = botInstances.get(adminUID);
    
    if (bot) {
        res.json({ 
            success: true, 
            running: true, 
            prefix: bot.prefix,
            commands: bot.commands 
        });
    } else {
        res.json({ success: true, running: false });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
});