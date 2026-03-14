/**
 * AI Chat Command
 * File: cmd/ai.js
 * Description: Chat with GPT-4 AI model
 */

const axios = require("axios");

module.exports = {
    // Command metadata
    name: 'ai',
    description: 'Chat with GPT-4 AI model',
    usage: '[your question] (can also reply to a message)',
    aliases: ['ask', 'gpt', 'chatgpt'],
    adminOnly: false,
    cooldown: 3,

    // Main execution function
    async execute({ api, event, args, reply, send, adminUID, commandName }) {
        const { messageID, messageReply, threadID, senderID } = event;
        let userInput = args.join(" ").trim();

        // Handle replied messages
        if (messageReply) {
            const repliedMessage = messageReply.body;
            userInput = `${repliedMessage} ${userInput}`;
        }

        // Check if user provided input
        if (!userInput) {
            return reply('❌ Please provide a question or reply to a message.\nUsage: ai [your question]');
        }

        try {
            await this.fetchAIResponse(api, event, userInput, senderID, reply);
        } catch (error) {
            console.error(`Error fetching AI response for "${userInput}":`, error);
            reply(`❌ Sorry, there was an error getting the AI response!`);
        }
    },

    // Helper function to fetch AI response
    async fetchAIResponse(api, event, userInput, senderID, reply) {
        const { threadID, messageID } = event;

        try {
            // API endpoint for ChatGPT
            const apiUrl = `https://yin-api.vercel.app/ai/chatgptfree?prompt=${encodeURIComponent(userInput)}&model=chatgpt4`;
            const response = await axios.get(apiUrl);

            if (response.data && response.data.answer) {
                const generatedText = response.data.answer;

                // Get user info for personalized response
                api.getUserInfo(senderID, (err, userInfo) => {
                    if (err) {
                        console.error('❌ Error fetching user info:', err);
                        reply('❌ Error fetching user info.');
                        return;
                    }

                    const userName = userInfo[senderID].name;
                    const formattedResponse = `━━━━━━━━━━━━━━━━━━\n${generatedText}\n━━━━━━━━━━━━━━━━━━`;

                    reply(formattedResponse);
                });
            } else {
                reply('❌ An error occurred while generating the response. Please try again later.');
            }
        } catch (error) {
            console.error('Error fetching from Yin API:', error.message || error);
            reply(`❌ Sorry, there was an error connecting to the AI service!`);
        }
    }
};