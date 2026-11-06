// Finds your Telegram chat ID. Send any message to your bot first, then run:
//   node scripts/get-chat-id.mjs
// and paste the bot token when asked. The token is only sent to api.telegram.org.
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const token = (process.env.TELEGRAM_BOT_TOKEN || (await rl.question('Bot token from @BotFather: '))).trim();
rl.close();

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = await res.json();
if (!body.ok) {
  console.error(`Telegram says: ${body.description}. Check the token.`);
  process.exit(1);
}

const chats = new Map();
for (const update of body.result) {
  const chat = (update.message ?? update.channel_post ?? update.my_chat_member)?.chat;
  if (chat) chats.set(chat.id, chat.first_name ?? chat.title ?? chat.username ?? '');
}
if (!chats.size) {
  console.log('No messages yet. Open your bot in Telegram, press Start or send "hi", then run this again.');
} else {
  for (const [id, name] of chats) console.log(`TELEGRAM_CHAT_ID = ${id}   (${name})`);
}
