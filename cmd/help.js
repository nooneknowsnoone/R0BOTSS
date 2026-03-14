module.exports = {
  description: "Show all command files and how to call them.",
  usage: "",
  async execute({ commands, prefix, reply }) {
    const lines = ["Available commands:"];

    for (const [commandName, command] of [...commands.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const usage = command.usage ? ` ${command.usage}` : "";
      const description = command.description ? ` - ${command.description}` : "";
      lines.push(`${prefix}${commandName}${usage}${description}`);
    }

    await reply(lines.join("\n"));
  },
};
