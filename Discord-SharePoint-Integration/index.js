// Pozřeby bota - načítání a další
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Imap = require('imap-simple');
const { simpleParser } = require('mailparser');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Spustí se až se načte
client.once('ready', () => {
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

                const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
                if (channel) {
                  channel.send(
                    `█▀█ ▀█ █▄░█ ▄▀█ █▀▄▀█ █▀▀ █▄░█ █\n█▄█ █▄ █░▀█ █▀█ █░▀░█ ██▄ █░▀█ █\nZpráva:\n \n${message}
                    \n@here`
                  ); // Od: ${creator}\n 
                }
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
