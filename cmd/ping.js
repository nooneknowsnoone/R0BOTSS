module.exports = {
  description: "Check if the bot is alive.",
  usage: "",
  async execute({ reply }) {
    await reply("Pong!");
  },
};
