require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const cron = require("node-cron");

// MongoDB connection
const connectToMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed, retrying...', error);
    setTimeout(connectToMongo, 5000); // Retry after 5 seconds
  }
};

connectToMongo();

// Define Mongoose models
const Reminder = mongoose.model(
  "Reminder",
  new mongoose.Schema({
    phase: Number,
    day: Number,
    focus: String,
    resource: String,
    practice: String,
    skipped: Boolean,
    pausedUntil: Date,
  })
);

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    telegramUserId: String,
    currentPhase: Number,
    currentDay: Number,
    pausedUntil: Date,
    reminderTime: { type: String, default: "10:00" }, // Default reminder time 10:00
  })
);

// Telegram bot setup
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });

const telegramWebhookUrl = "https://js-reminder-bot.vercel.app/api/bot";
bot.setWebHook(telegramWebhookUrl)
  .then(() => console.log("Webhook set successfully"))
  .catch((err) => console.error("Error setting webhook:", err));

// Command: /help
bot.onText(/\/help/, (msg) => {
  const telegramUserId = msg.from.id.toString();

  const helpMessage = `
    🆘 Available Commands:
    
    /remindnow - Get today's reminder without affecting regular reminders.
    /skip - Skip today's reminder and resume tomorrow.
    /pausefor [days] - Pause reminders for a specific number of days.
    /resume - Resume reminders immediately or at regular time.
    /status - View your current reminder status.
    /prev7 - Get reminders for the previous 7 days.
    /next7 - Get reminders for the next 7 days.
    /fullphase [phase] - Get all reminders for a specific phase.
    /timeset [hour:minute] - Set your daily reminder time (24-hour format).
    /remindtime - Check your current reminder time.
  `;

  bot.sendMessage(telegramUserId, helpMessage);
});

// Command: /remindnow
bot.onText(/\/remindnow/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  const reminder = await Reminder.findOne({
    phase: user.currentPhase,
    day: user.currentDay,
  });

  if (reminder) {
    bot.sendMessage(
      telegramUserId,
      `🔔 Today's Reminder:\n✅ Focus: ${reminder.focus}\n📘 Resource: ${reminder.resource}\n📝 Practice: ${reminder.practice}`
    );
  } else {
    bot.sendMessage(telegramUserId, "No reminder found for today.");
  }
});

// Command: /skip
bot.onText(/\/skip/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  user.currentDay += 1;
  await user.save();

  bot.sendMessage(
    telegramUserId,
    "Today's reminder skipped. Resuming tomorrow."
  );
});

// Command: /pausefor [days]
bot.onText(/\/pausefor (\d+)/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const daysToPause = parseInt(match[1]);
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  user.pausedUntil = new Date(Date.now() + daysToPause * 24 * 60 * 60 * 1000);
  await user.save();
  bot.sendMessage(telegramUserId, `Reminders paused for ${daysToPause} days.`);
});

// Command: /resume
bot.onText(/\/resume/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  user.pausedUntil = null;
  await user.save();
  bot.sendMessage(telegramUserId, "Reminders resumed.");
});

// Command: /status
bot.onText(/\/status/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  bot.sendMessage(
    telegramUserId,
    `📊 Status:\nPhase: ${user.currentPhase}\nDay: ${
      user.currentDay
    }\nReminders: ${
      user.pausedUntil
        ? `Paused until ${user.pausedUntil.toLocaleDateString()}`
        : "Active"
    }`
  );
});

// Command: /prev7
bot.onText(/\/prev7/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  const reminders = await Reminder.find({
    phase: user.currentPhase,
    day: { $gte: user.currentDay - 7, $lt: user.currentDay },
  });

  if (reminders.length > 0) {
    const message = reminders
      .map(
        (r) =>
          `Day ${r.day}: ${r.focus}\nResource: ${r.resource}\nPractice: ${r.practice}`
      )
      .join("\n\n");
    bot.sendMessage(telegramUserId, `📅 Previous 7 Days:\n${message}`);
  } else {
    bot.sendMessage(telegramUserId, "No past reminders found.");
  }
});

// Command: /next7
bot.onText(/\/next7/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });
  if (!user) return bot.sendMessage(telegramUserId, "User not found.");

  const reminders = await Reminder.find({
    phase: user.currentPhase,
    day: { $gt: user.currentDay, $lte: user.currentDay + 7 },
  });

  if (reminders.length > 0) {
    const message = reminders
      .map(
        (r) =>
          `Day ${r.day}: ${r.focus}\nResource: ${r.resource}\nPractice: ${r.practice}`
      )
      .join("\n\n");
    bot.sendMessage(telegramUserId, `📅 Next 7 Days:\n${message}`);
  } else {
    bot.sendMessage(telegramUserId, "No upcoming reminders found.");
  }
});

// Command: /fullphase [phase]
bot.onText(/\/fullphase (\d+)/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const phase = parseInt(match[1]);

  // Check if user exists in the database
  const user = await User.findOne({ telegramUserId });

  if (!user) {
    return bot.sendMessage(telegramUserId, "No user found in the database.");
  }

  // Get all reminders for a specific phase
  const reminders = await Reminder.find({ phase });

  if (reminders.length > 0) {
    let message = `📅 All Reminders for Phase ${phase}:\n`;
    reminders.forEach((reminder) => {
      message += `
        Day ${reminder.day}: ${reminder.focus}
        Resource: ${reminder.resource}
        Practice: ${reminder.practice}
      `;
    });
    bot.sendMessage(telegramUserId, message);
  } else {
    bot.sendMessage(telegramUserId, `No reminders found for Phase ${phase}.`);
  }
});

// Command: /timeset [HH:MM]
bot.onText(/\/timeset (\d{1,2}:\d{2})/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const timeInput = match[1];

  // Validate time format
  const [hour, minute] = timeInput.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return bot.sendMessage(
      telegramUserId,
      "Invalid time format. Use HH:MM (24-hour format). Example: /timeset 20:30 for 8:30 PM."
    );
  }

  // Convert to 12-hour format
  const amPm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  const formattedTime = `${hour12}:${minute
    .toString()
    .padStart(2, "0")} ${amPm}`;

  // Update user reminder time
  await User.findOneAndUpdate(
    { telegramUserId },
    { reminderTime: timeInput },
    { upsert: true }
  );

  bot.sendMessage(
    telegramUserId,
    `Your reminder time has been set to ${formattedTime}.`
  );
});

// Command: /remindtime
bot.onText(/\/remindtime/, async (msg) => {
  const telegramUserId = msg.from.id.toString();
  const user = await User.findOne({ telegramUserId });

  if (!user || !user.reminderTime) {
    return bot.sendMessage(
      telegramUserId,
      "You have not set a reminder time. Use /timeset HH:MM to set one."
    );
  }

  // Convert stored 24-hour time to 12-hour format
  const [hour, minute] = user.reminderTime.split(":").map(Number);
  const amPm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  const formattedTime = `${hour12}:${minute
    .toString()
    .padStart(2, "0")} ${amPm}`;

  bot.sendMessage(
    telegramUserId,
    `Your current reminder time is ${formattedTime}.`
  );
});


module.exports = async (req, res) => {
  console.log(`Request Method: ${req.method}`);
  console.log(`Request Body:`, req.body);

  if (req.method === "GET") {
    return res.status(200).send("Webhook is working");
  }
  if (req.method === "POST") {
    try {
      // Process the update only if no error has occurred yet
      await bot.processUpdate(req.body);
      return res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing update:", error);
      // Only send the response if no response has been sent already
      if (!res.headersSent) {
        return res.status(500).send("Internal Server Error");
      }
    }
  } else {
    return res.status(405).send("Method Not Allowed");
  }
};
