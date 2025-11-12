// Pozřeby bota - načítání a další
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits } = require('discord.js');
const Imap = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Global variable to store the ping role ID
let pingRoleId = null;

// Příkazy
const commands = [
  { name: 'oznameni-0', description: 'Vypne oznámení', default_member_permissions: String(PermissionFlagsBits.Administrator) },
  { name: 'oznameni-1', description: 'Zapne oznámení', default_member_permissions: String(PermissionFlagsBits.Administrator) },
  { name: 'status', description: 'Zobrazí stav bota' },
  {
    name: 'ping',
    description: 'Ping a specific role',
    options: [
      {
        name: 'role',
        description: 'The role to ping',
        type: 8, // ROLE type
        required: true
      },
      {
        name: 'message',
        description: 'Optional message to include with the ping',
        type: 3, // STRING type
        required: false
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function registerCommands() {
  try {
    if (!process.env.CLIENT_ID) {
      console.error('CLIENT_ID chybí v .env');
      return;
    }
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
    }
  } catch (error) {
    console.error('Chyba při registraci příkazů:', error);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  // Příkaz ping
  if (interaction.commandName === 'ping') {
    const role = interaction.options.getRole('role');
    const message = interaction.options.getString('message') || '';
    
    // Kontrola oprávnění
    if (!role.mentionable) {
      return interaction.reply({
        content: `❌ Nemám oprávnění pingovat ${role.name}. Ujisti se, že mám povolení tuto roli zmínit.`,
        ephemeral: true
      });
    }
    
    // Uložení ID role
    pingRoleId = role.id;
    
    // Potvrzení
    await interaction.reply({ 
      content: `✅ Role ${role} Je nyní nastavená pro zprávy.`,
      allowedMentions: { roles: [] },
      ephemeral: true
    });
    return;
  }
  
  // Admin-only guard na příkazy
  if ((interaction.commandName === 'oznameni-1' || interaction.commandName === 'oznameni-0' || interaction.commandName === 'ping') &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Tento příkaz mohou používat pouze administrátoři.', ephemeral: true });
    return;
  }
  if (interaction.commandName === 'oznameni-1') {
    const channelId = interaction.channelId;
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const match = envContent.match(/^DISCORD_CHANNEL_ID=.*$/m);
      let ids = [];
      if (match) {
        const value = match[0].split('=')[1].trim();
        ids = value.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (!ids.includes(channelId)) {
        ids.push(channelId);
      }
      const newLine = `DISCORD_CHANNEL_ID=${ids.join(',')}`;
      if (match) {
        envContent = envContent.replace(/^DISCORD_CHANNEL_ID=.*$/m, newLine);
      } else {
        if (envContent.length && !envContent.endsWith('\n')) envContent += '\n';
        envContent += `${newLine}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      process.env.DISCORD_CHANNEL_ID = ids.join(',');
      await interaction.reply(`Přidáno ID kanálu **${channelId}**. Nyní sem budeš dostávat oznámení`);
    } catch (err) {
      console.error('Chyba zápisu .env:', err);
      await interaction.reply('Nepodařilo se uložit ID kanálu do .env.');
    }
    return;
  } 
  if (interaction.commandName === 'oznameni-0') {
    const channelId = interaction.channelId;
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const match = envContent.match(/^DISCORD_CHANNEL_ID=.*$/m);
      if (!match) {
        await interaction.reply('V .env zatím není žádný seznam kanálů.');
        return;
      }

      const value = match[0].split('=')[1].trim();
      let ids = value.split(',').map(s => s.trim()).filter(Boolean);
      const beforeLen = ids.length;
      ids = ids.filter(id => id !== channelId);

      if (ids.length === beforeLen) {
        await interaction.reply('Tento kanál v seznamu nebyl.');
        return;
      }

      // Sestav novou hodnotu/odstran řádek pokud prázdné
      if (ids.length === 0) {
        envContent = envContent.replace(/^DISCORD_CHANNEL_ID=.*[\r\n]?/m, '');
        // úklid dvojitých koncových řádků
        envContent = envContent.replace(/\n+$/,'\n');
        delete process.env.DISCORD_CHANNEL_ID;
      } else {
        const newLine = `DISCORD_CHANNEL_ID=${ids.join(',')}`;
        envContent = envContent.replace(/^DISCORD_CHANNEL_ID=.*$/m, newLine);
        process.env.DISCORD_CHANNEL_ID = ids.join(',');
      }

      fs.writeFileSync(envPath, envContent);
      await interaction.reply(`Odebrán kanál ${channelId}. Zbývající: ${ids.join(', ') || 'žádné'}`);
    } catch (err) {
      console.error('Chyba zápisu .env:', err);
      await interaction.reply('Nepodařilo se upravit .env.');
    }
  } 
  if (interaction.commandName === 'status') {
    await interaction.reply(`Běžím jako ${interaction.client.user.tag}`);
  }
});

// Spustí se až se načte
client.once('ready', async () => {
  await registerCommands();
  console.log(`✅ Přihlášen jako ${client.user.tag}`);

  const config = {
    imap: {
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASS,
      host: 'imap.seznam.cz',
      port: 993,
      tls: true
    }
  };

  Imap.connect(config).then(connection => {
    return connection.openBox('INBOX').then(() => {
      console.log("📬 IMAP připojení aktivní");

      connection.on('mail', () => {
        console.log("📨 Dorazil nový e‑mail, hledám UNSEEN...");

        connection.search(['UNSEEN'], { bodies: ['HEADER', 'TEXT'], markSeen: true })
          .then(messages => {
            console.log("Nalezeno zpráv:", messages.length);

            messages.forEach(msg => {
              const all = msg.parts.find(p => p.which === 'TEXT');
              if (!all) return;

              simpleParser(all.body, (err, parsed) => {
                if (err) return console.error("❌ Chyba při parsování:", err);

                const rawText = parsed.text || "";
                console.log("📌 RAW TEXT:\n", rawText);

                // Odesílatel
                const creatorMatch = rawText.match(/Od:\s*(.+)/i);
                const creator = creatorMatch ? creatorMatch[1].trim() : "Neznámý";

                // Zpráva mezi "Od:" a "@here"
                const messageMatch = rawText.match(/Od:[\s\S]*?\n([\s\S]*?)(?=@here|$)/i);
                let message = messageMatch ? messageMatch[1].trim() : "";

                // Očista
                message = message
                  .replace(/['"]/g, "")
                  .replace(/--_+[A-Za-z0-9-]+/g, "")
                  .replace(/Content-Type:.*/gi, "")
                  .replace(/<[^>]+>/g, "")
                  .replace(/[-]{2,}\s*podrobnosti zde/gi, "")
                  .trim();

                // Rozdělení na řádky + odstranění prázdných
                let lines = message.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

                // Zvýraznění prvního řádku zprávy
                if (lines.length > 0) {
                  lines[0] = `**${lines[0]}**`;
                }
                message = lines.join("\n");

                console.log("📌 CREATOR:", creator);
                console.log("📌 MESSAGE:", message);

                const idsEnv = process.env.DISCORD_CHANNEL_ID || '';
                const ids = idsEnv.split(',').map(s => s.trim()).filter(Boolean);
                const roleMention = pingRoleId ? `<@&${pingRoleId}>` : '@here';
                const payload = `█▀█ ▀█ █▄░█ ▄▀█ █▀▄▀█ █▀▀ █▄░█ █\n█▄█ █▄ █░▀█ █▀█ █░▀░█ ██▄ █░▀█ █\nZpráva:\n\n${message}\n${roleMention}`;

                ids.forEach(id => {
                  client.channels.fetch(id)
                    .then(channel => {
                      if (channel) {
                        channel.send(payload); // Od: ${creator}
                      }
                    })
                    .catch(err => console.error('❌ Chyba odesílání do kanálu', id, err));
                });
              });
            });
          });
      });
    });
  }).catch(err => {
    console.error("❌ Chyba při připojení k IMAP:", err);
  });
});

client.login(process.env.TOKEN);

console.log("Token z .env:", process.env.TOKEN ? "✅ Načten" : "❌ Nenalezen");
