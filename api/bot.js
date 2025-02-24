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

// In-memory command queue
const userCommandQueue = {};

// Command: /help
bot.onText(/\/help/, (msg) => {
  const telegramUserId = msg.from.id.toString();

  const helpMessage = `🆘 Available Commands:

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

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
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
  } catch (error) {
    console.error("Error processing /remindnow:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /skip
bot.onText(/\/skip/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    user.currentDay += 1;
    await user.save();

    // Reload user data to ensure latest state
    const updatedUser = await User.findOne({ telegramUserId });

    bot.sendMessage(
      telegramUserId,
      `Today's reminder skipped. Resuming tomorrow. Current day: ${updatedUser.currentDay}`
    );
  } catch (error) {
    console.error("Error processing /skip:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /pausefor [days]
bot.onText(/\/pausefor (\d+)/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const daysToPause = parseInt(match[1]);

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    user.pausedUntil = new Date(Date.now() + daysToPause * 24 * 60 * 60 * 1000);
    await user.save();

    bot.sendMessage(telegramUserId, `Reminders paused for ${daysToPause} days.`);
  } catch (error) {
    console.error("Error processing /pausefor:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /resume
bot.onText(/\/resume/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    user.pausedUntil = null;
    await user.save();

    bot.sendMessage(telegramUserId, "Reminders resumed.");
  } catch (error) {
    console.error("Error processing /resume:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /status
bot.onText(/\/status/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    bot.sendMessage(
      telegramUserId,
      `📊 Status:\nPhase: ${user.currentPhase}\nDay: ${user.currentDay}\nReminders: ${
        user.pausedUntil
          ? `Paused until ${user.pausedUntil.toLocaleDateString()}`
          : "Active"
      }`
    );
  } catch (error) {
    console.error("Error processing /status:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /prev7
bot.onText(/\/prev7/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
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
  } catch (error) {
    console.error("Error processing /prev7:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /next7
bot.onText(/\/next7/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    const reminders = await Reminder.find({
      phase: user.currentPhase,
      day: { $gt: user.currentDay, $lt: user.currentDay + 7 },
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
  } catch (error) {
    console.error("Error processing /next7:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /fullphase [phase]
bot.onText(/\/fullphase (\d+)/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const phase = parseInt(match[1]);

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const reminders = await Reminder.find({ phase });

    if (reminders.length > 0) {
      const message = reminders
        .map(
          (r) =>
            `Day ${r.day}: ${r.focus}\nResource: ${r.resource}\nPractice: ${r.practice}`
        )
        .join("\n\n");
      bot.sendMessage(telegramUserId, `📅 Full Phase ${phase} Reminders:\n${message}`);
    } else {
      bot.sendMessage(telegramUserId, `No reminders found for phase ${phase}.`);
    }
  } catch (error) {
    console.error("Error processing /fullphase:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /timeset [hour:minute]
bot.onText(/\/timeset (\d{2}:\d{2})/, async (msg, match) => {
  const telegramUserId = msg.from.id.toString();
  const time = match[1];

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    user.reminderTime = time;
    await user.save();

    bot.sendMessage(telegramUserId, `Your reminder time has been set to ${time}.`);
  } catch (error) {
    console.error("Error processing /timeset:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
});

// Command: /remindtime
bot.onText(/\/remindtime/, async (msg) => {
  const telegramUserId = msg.from.id.toString();

  // Check if user is in queue (already processing)
  if (userCommandQueue[telegramUserId]) {
    return bot.sendMessage(telegramUserId, "Please wait while I process your previous request.");
  }

  // Add user to the queue
  userCommandQueue[telegramUserId] = true;

  try {
    const user = await User.findOne({ telegramUserId });
    if (!user) return bot.sendMessage(telegramUserId, "User not found.");

    bot.sendMessage(telegramUserId, `Your current reminder time is ${user.reminderTime}.`);
  } catch (error) {
    console.error("Error processing /remindtime:", error);
    bot.sendMessage(telegramUserId, "There was an error processing your request.");
  } finally {
    // Remove user from queue after processing
    delete userCommandQueue[telegramUserId];
  }
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
