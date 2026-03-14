/**
 * Echo Command - Repeats user message
 * File: cmd/echo.js
 * Description: Simple command to echo user's message back
 */

module.exports = {
    // Command metadata
    name: 'echo',                    // Command name (optional, defaults to filename)
    description: 'Repeat your message back to you',
    usage: '<text>',                  // Usage instructions (text to echo)
    aliases: ['say', 'repeat', 'tell'], // Alternative names for the command
    adminOnly: false,                 // If true, only admin can use
    cooldown: 3,                      // Cooldown in seconds between uses
    
    // Main execution function
    async execute({ api, event, args, reply, send, adminUID, commandName }) {
        // Get start time for response time calculation
        const startTime = Date.now();
        
        // Join all arguments into one string
        const text = args.join(' ');
        
        // Check if text was provided
        if (!text) {
            return reply(`❌ Please provide text to echo!\nUsage: ${commandName} Hello World`);
        }
        
        // Echo the message with formatting
        await reply(`📢 **Echo:**\n${text}`);
        
        // Calculate response time
        const responseTime = Date.now() - startTime;
        
        // Send additional info with user details
        await reply(`👤 **From:** ${event.senderID}\n💬 **Message:** ${text}\n⏱️ **Response time:** ${responseTime}ms`);
        
        // Log command usage (optional)
        console.log(`📊 Echo used by ${event.senderID} in thread ${event.threadID} | Message: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
};