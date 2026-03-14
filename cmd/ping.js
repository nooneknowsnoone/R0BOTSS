module.exports = {
    description: "Check if bot is alive and responding",
    usage: "",
    aliases: ["p", "pingpong", "test"],
    
    async execute({ api, event, args, reply, adminUID }) {
        const startTime = Date.now();
        
        // Get additional info if provided
        const extra = args.join(' ');
        
        // Simple ping response with emoji
        let response = "🏓 Pong!";
        
        // Add response time
        const responseTime = Date.now() - startTime;
        response += `\n⏱️ Response time: ${responseTime}ms`;
        
        // Add timestamp
        const time = new Date().toLocaleTimeString();
        response += `\n🕐 Time: ${time}`;
        
        // Add extra text if provided
        if (extra) {
            response += `\n📝 You said: ${extra}`;
        }
        
        // Send the response
        await reply(response);
        
        // Optional: Log command usage
        console.log(`📊 Ping command used by ${event.senderID} in thread ${event.threadID}`);
    }
};