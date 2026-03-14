module.exports = {
  description: "Show your Facebook name and ID.",
  usage: "",
  async execute({ event, getUserInfo, reply }) {
    const info = await getUserInfo(event.senderID);
    const user = info[event.senderID] || info;

    await reply(`Name: ${user?.name || "Unknown"}\nID: ${event.senderID}`);
  },
};
