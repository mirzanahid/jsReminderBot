require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const cron = require("node-cron");

// MongoDB connection
const connectToMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed, retrying...', error);
    setTimeout(connectToMongo, 5000);
  }
};

connectToMongo();

// Define Mongoose models
const Reminder = mongoose.model("Reminder", new mongoose.Schema({
  phase: Number,
  day: Number,
  focus: String,
  resource: String,
  practice: String,
  skipped: Boolean,
  pausedUntil: Date,
}));

const User = mongoose.model("User", new mongoose.Schema({
  telegramUserId: String,
  currentPhase: Number,
  currentDay: Number,
  pausedUntil: Date,
  reminderTime: { type: String, default: "10:00" },
}));

// Telegram bot setup
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
const telegramWebhookUrl = "https://js-reminder-bot.vercel.app/api/bot";

bot.setWebHook(telegramWebhookUrl)
  .then(() => console.log("Webhook set successfully"))
  .catch((err) => console.error("Error setting webhook:", err));

// Asynchronous handler for bot commands
const sendMessageAsync = async (chatId, text) => {
  try {
    await bot.sendMessage(chatId, text);
  } catch (error) {
    console.error("Error sending message:", error);
  }
};

// Command Handlers
bot.onText(/\/help/, async (msg) => {
  const helpMessage = `🆘 Available Commands:\n\n/remindnow - Get today's reminder\n/skip - Skip today's reminder\n/pausefor [days] - Pause reminders\n/resume - Resume reminders\n/status - View your status\n/prev7 - Get past 7 days\n/next7 - Get next 7 days\n/fullphase [phase] - Get phase reminders\n/timeset [HH:MM] - Set reminder time\n/remindtime - Check reminder time`;
  await sendMessageAsync(msg.chat.id, helpMessage);
});

bot.onText(/\/remindnow/, async (msg) => {
  const user = await User.findOne({ telegramUserId: msg.from.id.toString() });
  if (!user) return sendMessageAsync(msg.chat.id, "User not found.");
  
  const reminder = await Reminder.findOne({ phase: user.currentPhase, day: user.currentDay });
  if (reminder) {
    await sendMessageAsync(msg.chat.id, `🔔 Today's Reminder:\n✅ Focus: ${reminder.focus}\n📘 Resource: ${reminder.resource}\n📝 Practice: ${reminder.practice}`);
  } else {
    await sendMessageAsync(msg.chat.id, "No reminder found for today.");
  }
});

bot.onText(/\/skip/, async (msg) => {
  const user = await User.findOne({ telegramUserId: msg.from.id.toString() });
  if (!user) return sendMessageAsync(msg.chat.id, "User not found.");
  
  user.currentDay += 1;
  await user.save();
  await sendMessageAsync(msg.chat.id, "Today's reminder skipped. Resuming tomorrow.");
});

bot.onText(/\/pausefor (\d+)/, async (msg, match) => {
  const user = await User.findOne({ telegramUserId: msg.from.id.toString() });
  if (!user) return sendMessageAsync(msg.chat.id, "User not found.");
  
  user.pausedUntil = new Date(Date.now() + parseInt(match[1]) * 24 * 60 * 60 * 1000);
  await user.save();
  await sendMessageAsync(msg.chat.id, `Reminders paused for ${match[1]} days.`);
});

bot.onText(/\/resume/, async (msg) => {
  const user = await User.findOne({ telegramUserId: msg.from.id.toString() });
  if (!user) return sendMessageAsync(msg.chat.id, "User not found.");
  
  user.pausedUntil = null;
  await user.save();
  await sendMessageAsync(msg.chat.id, "Reminders resumed.");
});

bot.onText(/\/status/, async (msg) => {
  const user = await User.findOne({ telegramUserId: msg.from.id.toString() });
  if (!user) return sendMessageAsync(msg.chat.id, "User not found.");
  
  const statusMessage = `📊 Status:\nPhase: ${user.currentPhase}\nDay: ${user.currentDay}\nReminders: ${user.pausedUntil ? `Paused until ${user.pausedUntil.toLocaleDateString()}` : "Active"}`;
  await sendMessageAsync(msg.chat.id, statusMessage);
});

module.exports = async (req, res) => {
  console.log(`Request Method: ${req.method}`);
  console.log(`Request Body:`, req.body);

  if (req.method === "GET") {
    return res.status(200).send("Webhook is working");
  }
  if (req.method === "POST") {
    try {
      await bot.processUpdate(req.body);
      return res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing update:", error);
      if (!res.headersSent) {
        return res.status(500).send("Internal Server Error");
      }
    }
  } else {
    return res.status(405).send("Method Not Allowed");
  }
};
