require('dotenv').config();

const process = require('process');
const Discord = require('discord.js');
const client = new Discord.Client();


//  Get bot commands
//
const fs = require('fs');
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

/** @type {Discord.Collection} */
client.commands = new Discord.Collection();

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}


const prefix = '!zimbra';

const helpMsg = new Discord.RichEmbed()
    .setTitle('Usage')
    .setDescription(
      client.commands.map(c => `${prefix} ${c.usage}`).join('\n') +
      '\n\n' +
      'Commands:\n' +
      client.commands.map(c => `‣ ${c.name} - ${c.description}`).join('\n') +
      '\n\n' +
      'Call a command help for detailed description');


client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.commands.forEach(cmd => {
    if (cmd.init) { cmd.init(client); }
  });
});

client.on('message', async (msg) => {
  if (msg.author.bot) { return; }
  if (msg.content === 'help') { msg.channel.send(helpMsg); return; }
  if (!msg.content.startsWith(prefix)) { return; }

  const params = msg.content.slice(prefix.length).split(/ +/).filter(el => el.length > 0);
  const commandName = params.length > 0 ? params.shift().toLocaleLowerCase() : undefined;

  if (commandName === undefined || commandName === 'help') {
    msg.channel.send(helpMsg);
    return;
  }
  if (!client.commands.has(commandName)) {
    msg.reply(`Unknown command '${commandName}'`);
    return;
  }

  const command = client.commands.get(commandName);

  if (command.params && params.length <= 0) {
    msg.reply(`The command '${commandName}' requires some params!`);
    return;
  }

  try {
    await command.execute(msg, params);
  }
  catch (error) {
    console.error(error);
    msg.reply('There was an error trying to execute that command!');
  }
});

client.login(process.env.BOT_TOKEN);
