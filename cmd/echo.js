module.exports = {
  description: "Repeat the text that you send.",
  usage: "<text>",
  async execute({ args, reply }) {
    const text = args.join(" ") || "You did not send any text.";
    await reply(`Echo: ${text}`);
  },
};
