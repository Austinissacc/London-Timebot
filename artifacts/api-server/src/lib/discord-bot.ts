import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Interaction,
  TextChannel,
  Message,
} from "discord.js";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { remindersTable } from "@workspace/db";
import { lt, eq, and } from "drizzle-orm";

const LONDON_TIMEZONE = "Europe/London";
// Discord rate-limits channel renames to 2 per 10 minutes per channel.
// We update every 10 minutes to stay safely within that limit.
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
const LIVE_CLOCK_INTERVAL_MS = 60 * 1000;
const LIVE_CLOCK_TAG = "<!-- london-live-clock -->";

// ── Timezone lookup ─────────────────────────────────────────────

const TIMEZONE_ALIASES: Record<string, string> = {
  london: "Europe/London",
  uk: "Europe/London",
  "new york": "America/New_York",
  "new_york": "America/New_York",
  newyork: "America/New_York",
  nyc: "America/New_York",
  "los angeles": "America/Los_Angeles",
  la: "America/Los_Angeles",
  "los_angeles": "America/Los_Angeles",
  chicago: "America/Chicago",
  toronto: "America/Toronto",
  saopaulo: "America/Sao_Paulo",
  "sao paulo": "America/Sao_Paulo",
  "sao_paulo": "America/Sao_Paulo",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  amsterdam: "Europe/Amsterdam",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  moscow: "Europe/Moscow",
  dubai: "Asia/Dubai",
  uae: "Asia/Dubai",
  mumbai: "Asia/Kolkata",
  india: "Asia/Kolkata",
  kolkata: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bangkok: "Asia/Bangkok",
  singapore: "Asia/Singapore",
  hongkong: "Asia/Hong_Kong",
  "hong kong": "Asia/Hong_Kong",
  "hong_kong": "Asia/Hong_Kong",
  shanghai: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  china: "Asia/Shanghai",
  tokyo: "Asia/Tokyo",
  japan: "Asia/Tokyo",
  seoul: "Asia/Seoul",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  auckland: "Pacific/Auckland",
  hawaii: "Pacific/Honolulu",
  utc: "UTC",
};

const WORLDCLOCK_ZONES: Array<{ label: string; tz: string; flag: string }> = [
  { label: "London", tz: "Europe/London", flag: "🇬🇧" },
  { label: "New York", tz: "America/New_York", flag: "🇺🇸" },
  { label: "Los Angeles", tz: "America/Los_Angeles", flag: "🇺🇸" },
  { label: "Dubai", tz: "Asia/Dubai", flag: "🇦🇪" },
  { label: "Mumbai", tz: "Asia/Kolkata", flag: "🇮🇳" },
  { label: "Singapore", tz: "Asia/Singapore", flag: "🇸🇬" },
  { label: "Tokyo", tz: "Asia/Tokyo", flag: "🇯🇵" },
  { label: "Sydney", tz: "Australia/Sydney", flag: "🇦🇺" },
];

function resolveTimezone(input: string): string | null {
  const key = input.trim().toLowerCase();
  if (TIMEZONE_ALIASES[key]) return TIMEZONE_ALIASES[key]!;
  // Try it as a raw IANA timezone string
  try {
    Intl.DateTimeFormat(undefined, { timeZone: input });
    return input;
  } catch {
    return null;
  }
}

function getTimeInZone(tz: string): { time: string; date: string } {
  const now = new Date();
  const time = now.toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = now.toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return { time, date };
}

// ── Time helpers ────────────────────────────────────────────────

function getLondonTime(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getLondonDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getLondonTimeShort(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getLondonDateShort(): string {
  return new Date().toLocaleDateString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Parse "YYYY-MM-DD HH:MM" → Date (treated as London time) */
function parseLondonDatetime(dateStr: string, timeStr: string): Date | null {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^\d{2}:\d{2}$/;
  if (!datePattern.test(dateStr) || !timePattern.test(timeStr)) return null;

  const isoString = `${dateStr}T${timeStr}:00`;
  // Convert the local London time to UTC by using Intl
  const londonDate = new Date(
    new Date(isoString).toLocaleString("en-US", { timeZone: LONDON_TIMEZONE }),
  );
  if (isNaN(londonDate.getTime())) return null;

  // Proper approach: parse as London time
  const utcDate = new Date(
    new Date(`${dateStr}T${timeStr}:00`).getTime() -
      getTimezoneOffsetMs(dateStr, timeStr),
  );
  return utcDate;
}

function getTimezoneOffsetMs(dateStr: string, timeStr: string): number {
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  const londonStr = localDate.toLocaleString("en-GB", { timeZone: LONDON_TIMEZONE });
  // We use a simpler approach: Intl.DateTimeFormat offset trick
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  void londonStr;
  void formatter;
  return 0; // fallback — use direct ISO approach below
}

/** Better parser: treat input as London local time, convert to UTC */
function parseLondonLocal(dateStr: string, timeStr: string): Date | null {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^\d{2}:\d{2}$/;
  if (!datePattern.test(dateStr) || !timePattern.test(timeStr)) return null;

  // Build the date in London timezone using Temporal-style trick
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  void parts;

  // Simplest reliable approach: use the offset at that point in time
  // Create a reference date in UTC, then adjust
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  if (isNaN(naiveUtc.getTime())) return null;

  // Find London offset at that naive time
  const londonTimeStr = naiveUtc.toLocaleString("en-US", {
    timeZone: LONDON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const londonDate = new Date(londonTimeStr);
  const offsetMs = naiveUtc.getTime() - londonDate.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

/** Generic parser: treat input as local time in any IANA timezone, convert to UTC */
function parseLocalDatetime(dateStr: string, timeStr: string, tz: string): Date | null {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const timePattern = /^\d{2}:\d{2}$/;
  if (!datePattern.test(dateStr) || !timePattern.test(timeStr)) return null;

  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  if (isNaN(naiveUtc.getTime())) return null;

  const tzTimeStr = naiveUtc.toLocaleString("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const tzDate = new Date(tzTimeStr);
  const offsetMs = naiveUtc.getTime() - tzDate.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

function formatRemindAt(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Slash commands ──────────────────────────────────────────────

const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Get the current London time");

const timeCommand = new SlashCommandBuilder()
  .setName("time")
  .setDescription("Get the current time in any city or timezone")
  .addStringOption((opt) =>
    opt
      .setName("zone")
      .setDescription('City or timezone, e.g. "Tokyo", "Dubai", "America/Chicago"')
      .setRequired(true),
  );

const worldclockCommand = new SlashCommandBuilder()
  .setName("worldclock")
  .setDescription("Show current time across major world cities");

const remindCommand = new SlashCommandBuilder()
  .setName("remind")
  .setDescription("Manage event reminders")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a new reminder")
      .addStringOption((opt) =>
        opt.setName("title").setDescription("What to remind you about").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("date")
          .setDescription("Date in YYYY-MM-DD format, e.g. 2026-07-01")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("time")
          .setDescription("Time in HH:MM format, e.g. 14:30")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("timezone")
          .setDescription('City or timezone for the time, e.g. "Tokyo", "Dubai" (default: London)')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all upcoming reminders"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a reminder by ID")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Reminder ID from /remind list").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("edit")
      .setDescription("Edit an existing reminder's title, date, time, or timezone")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("Reminder ID from /remind list").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("title").setDescription("New title (leave blank to keep current)").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("date").setDescription("New date in YYYY-MM-DD format (leave blank to keep current)").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("time").setDescription("New time in HH:MM format (leave blank to keep current)").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("timezone").setDescription('Timezone for the new date/time, e.g. "Tokyo" (default: London)').setRequired(false),
      ),
  );

async function registerSlashCommands(token: string, clientId: string): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: [
      statusCommand.toJSON(),
      timeCommand.toJSON(),
      worldclockCommand.toJSON(),
      remindCommand.toJSON(),
    ],
  });
  logger.info("Slash commands registered globally");
}

// ── Slash command handlers ──────────────────────────────────────

async function handleStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: `🕐 **London Time**\n**Time:** ${getLondonTime()}\n**Date:** ${getLondonDate()}`,
  });
}

async function handleTimeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const input = interaction.options.getString("zone", true);
  const tz = resolveTimezone(input);
  if (!tz) {
    await interaction.reply({
      content:
        `❌ Unknown city or timezone: \`${input}\`\n` +
        `Try a city name like \`Tokyo\`, \`Dubai\`, \`New York\` or an IANA zone like \`America/Chicago\`.`,
      ephemeral: true,
    });
    return;
  }
  const { time, date } = getTimeInZone(tz);
  await interaction.reply({
    content: `🌍 **Time in ${input}**\n**Time:** \`${time}\`\n**Date:** ${date}`,
  });
}

async function handleWorldclockCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const lines = WORLDCLOCK_ZONES.map(({ label, tz, flag }) => {
    const { time } = getTimeInZone(tz);
    return `${flag} **${label}** — \`${time}\``;
  });
  await interaction.reply({
    content: `🌐 **World Clock**\n\n${lines.join("\n")}`,
  });
}

async function handleRemindAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const title = interaction.options.getString("title", true);
  const dateStr = interaction.options.getString("date", true);
  const timeStr = interaction.options.getString("time", true);
  const tzInput = interaction.options.getString("timezone", false);

  // Resolve timezone — default to London
  let tz = LONDON_TIMEZONE;
  let tzLabel = "London";
  if (tzInput) {
    const resolved = resolveTimezone(tzInput);
    if (!resolved) {
      await interaction.reply({
        content:
          `❌ Unknown timezone: \`${tzInput}\`\n` +
          `Try a city name like \`Tokyo\`, \`Dubai\`, \`New York\` or an IANA zone like \`America/Chicago\`.`,
        ephemeral: true,
      });
      return;
    }
    tz = resolved;
    tzLabel = tzInput;
  }

  const remindAt = parseLocalDatetime(dateStr, timeStr, tz);
  if (!remindAt) {
    await interaction.reply({
      content: "❌ Invalid date or time. Use `YYYY-MM-DD` for date and `HH:MM` for time.",
      ephemeral: true,
    });
    return;
  }

  if (remindAt <= new Date()) {
    await interaction.reply({
      content: "❌ That time is in the past. Please pick a future date and time.",
      ephemeral: true,
    });
    return;
  }

  const [reminder] = await db
    .insert(remindersTable)
    .values({
      title,
      remindAt,
      channelId: interaction.channelId,
      userId: interaction.user.id,
    })
    .returning();

  await interaction.reply({
    content:
      `✅ Reminder **#${reminder!.id}** set!\n` +
      `📌 **${title}**\n` +
      `🕐 ${dateStr} at ${timeStr} (${tzLabel})\n` +
      `_Fires at ${formatRemindAt(remindAt)} London time_`,
  });
}

async function handleRemindList(interaction: ChatInputCommandInteraction): Promise<void> {
  const reminders = await db
    .select()
    .from(remindersTable)
    .where(eq(remindersTable.fired, false))
    .orderBy(remindersTable.remindAt);

  if (reminders.length === 0) {
    await interaction.reply({ content: "📭 No upcoming reminders.", ephemeral: true });
    return;
  }

  const lines = reminders.map(
    (r) => `**#${r.id}** — ${r.title}\n   🕐 ${formatRemindAt(r.remindAt)} (London) · <@${r.userId}>`,
  );

  await interaction.reply({
    content: `📋 **Upcoming Reminders**\n\n${lines.join("\n\n")}`,
    ephemeral: true,
  });
}

async function handleRemindEdit(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  const newTitle = interaction.options.getString("title", false);
  const newDate = interaction.options.getString("date", false);
  const newTime = interaction.options.getString("time", false);
  const tzInput = interaction.options.getString("timezone", false);

  // Must supply at least one field to change
  if (!newTitle && !newDate && !newTime) {
    await interaction.reply({
      content: "❌ Provide at least one of `title`, `date`, or `time` to update.",
      ephemeral: true,
    });
    return;
  }

  // Load the existing reminder
  const [existing] = await db
    .select()
    .from(remindersTable)
    .where(and(eq(remindersTable.id, id), eq(remindersTable.fired, false)));

  if (!existing) {
    await interaction.reply({
      content: `❌ No active reminder with ID **#${id}** found.`,
      ephemeral: true,
    });
    return;
  }

  // Resolve timezone if provided (used only when date/time is being changed)
  let tz = LONDON_TIMEZONE;
  let tzLabel = "London";
  if (tzInput) {
    const resolved = resolveTimezone(tzInput);
    if (!resolved) {
      await interaction.reply({
        content:
          `❌ Unknown timezone: \`${tzInput}\`\n` +
          `Try a city name like \`Tokyo\`, \`Dubai\`, \`New York\` or an IANA zone like \`America/Chicago\`.`,
        ephemeral: true,
      });
      return;
    }
    tz = resolved;
    tzLabel = tzInput;
  }

  // Build the updated remindAt if date or time changed
  let remindAt = existing.remindAt;
  if (newDate || newTime) {
    // Use existing date/time as fallback when only one is changed
    const existingInTz = existing.remindAt.toLocaleString("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // en-GB format: DD/MM/YYYY, HH:MM
    const [datePart, timePart] = existingInTz.split(", ");
    const [dd, mm, yyyy] = (datePart ?? "").split("/");
    const fallbackDate = `${yyyy}-${mm}-${dd}`;
    const fallbackTime = (timePart ?? "00:00").slice(0, 5);

    const dateStr = newDate ?? fallbackDate;
    const timeStr = newTime ?? fallbackTime;

    const parsed = parseLocalDatetime(dateStr!, timeStr!, tz);
    if (!parsed) {
      await interaction.reply({
        content: "❌ Invalid date or time. Use `YYYY-MM-DD` for date and `HH:MM` for time.",
        ephemeral: true,
      });
      return;
    }
    if (parsed <= new Date()) {
      await interaction.reply({
        content: "❌ The new time is in the past. Please pick a future date and time.",
        ephemeral: true,
      });
      return;
    }
    remindAt = parsed;
  }

  const updatedTitle = newTitle ?? existing.title;

  await db
    .update(remindersTable)
    .set({ title: updatedTitle, remindAt })
    .where(eq(remindersTable.id, id));

  const changes: string[] = [];
  if (newTitle) changes.push(`📝 Title → **${updatedTitle}**`);
  if (newDate || newTime) changes.push(`🕐 Time → ${formatRemindAt(remindAt)} (London) _(${tzLabel})_`);

  await interaction.reply({
    content: `✏️ Reminder **#${id}** updated!\n\n${changes.join("\n")}`,
    ephemeral: true,
  });
}

async function handleRemindRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  const deleted = await db
    .delete(remindersTable)
    .where(and(eq(remindersTable.id, id), eq(remindersTable.fired, false)))
    .returning();

  if (deleted.length === 0) {
    await interaction.reply({
      content: `❌ No active reminder with ID **#${id}** found.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: `🗑️ Reminder **#${id}** removed.`, ephemeral: true });
}

// ── Message-based reminders ─────────────────────────────────────
// Format: !remind add <title> | <YYYY-MM-DD> <HH:MM>
//         !remind list
//         !remind remove <id>

async function handleReminderMessage(
  message: Message,
  reminderChannelId: string,
): Promise<void> {
  void reminderChannelId;
  const content = message.content.trim();
  if (!content.startsWith("!remind")) return;

  const args = content.slice("!remind".length).trim();

  if (args.startsWith("list")) {
    const reminders = await db
      .select()
      .from(remindersTable)
      .where(eq(remindersTable.fired, false))
      .orderBy(remindersTable.remindAt);

    if (reminders.length === 0) {
      await message.reply("📭 No upcoming reminders.");
      return;
    }

    const lines = reminders.map(
      (r) => `**#${r.id}** — ${r.title}\n   🕐 ${formatRemindAt(r.remindAt)} (London) · <@${r.userId}>`,
    );
    await message.reply(`📋 **Upcoming Reminders**\n\n${lines.join("\n\n")}`);
    return;
  }

  if (args.startsWith("remove")) {
    const idStr = args.slice("remove".length).trim();
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      await message.reply("❌ Usage: `!remind remove <id>`");
      return;
    }
    const deleted = await db
      .delete(remindersTable)
      .where(and(eq(remindersTable.id, id), eq(remindersTable.fired, false)))
      .returning();

    if (deleted.length === 0) {
      await message.reply(`❌ No active reminder with ID **#${id}** found.`);
    } else {
      await message.reply(`🗑️ Reminder **#${id}** removed.`);
    }
    return;
  }

  if (args.startsWith("add")) {
    // Format: add <title> | <YYYY-MM-DD> <HH:MM>
    const rest = args.slice("add".length).trim();
    const pipeIndex = rest.lastIndexOf("|");
    if (pipeIndex === -1) {
      await message.reply(
        "❌ Usage: `!remind add <title> | <YYYY-MM-DD> <HH:MM>`\nExample: `!remind add Team standup | 2026-07-01 09:00`",
      );
      return;
    }

    const title = rest.slice(0, pipeIndex).trim();
    const datetime = rest.slice(pipeIndex + 1).trim();
    const [dateStr, timeStr] = datetime.split(" ");

    if (!title || !dateStr || !timeStr) {
      await message.reply(
        "❌ Usage: `!remind add <title> | <YYYY-MM-DD> <HH:MM>`\nExample: `!remind add Team standup | 2026-07-01 09:00`",
      );
      return;
    }

    const remindAt = parseLondonLocal(dateStr, timeStr);
    if (!remindAt) {
      await message.reply("❌ Invalid date or time. Use `YYYY-MM-DD` and `HH:MM`.");
      return;
    }

    if (remindAt <= new Date()) {
      await message.reply("❌ That time is in the past. Please pick a future time.");
      return;
    }

    const [reminder] = await db
      .insert(remindersTable)
      .values({
        title,
        remindAt,
        channelId: message.channelId,
        userId: message.author.id,
      })
      .returning();

    await message.reply(
      `✅ Reminder **#${reminder!.id}** set!\n📌 **${title}**\n🕐 ${formatRemindAt(remindAt)} (London time)`,
    );
    return;
  }

  await message.reply(
    "ℹ️ **Reminder commands:**\n" +
      "`!remind add <title> | <YYYY-MM-DD> <HH:MM>` — Add reminder\n" +
      "`!remind list` — List upcoming reminders\n" +
      "`!remind remove <id>` — Remove a reminder",
  );
}

// ── Reminder fire loop ──────────────────────────────────────────

async function fireReminders(client: Client, reminderChannelId: string): Promise<void> {
  try {
    const due = await db
      .select()
      .from(remindersTable)
      .where(and(eq(remindersTable.fired, false), lt(remindersTable.remindAt, new Date())));

    for (const reminder of due) {
      try {
        const channel = await client.channels.fetch(reminderChannelId);
        if (channel instanceof TextChannel) {
          await channel.send(
            `🔔 **Reminder!** <@${reminder.userId}>\n📌 **${reminder.title}**\n🕐 Scheduled for ${formatRemindAt(reminder.remindAt)} (London time)`,
          );
        }

        await db
          .update(remindersTable)
          .set({ fired: true })
          .where(eq(remindersTable.id, reminder.id));

        logger.info({ reminderId: reminder.id, title: reminder.title }, "Reminder fired");
      } catch (err) {
        logger.error({ err, reminderId: reminder.id }, "Failed to fire reminder");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to check reminders");
  }
}

// ── Live clock pinned message ───────────────────────────────────

function buildClockMessage(): string {
  const time = getLondonTime();
  const date = getLondonDate();
  return (
    `${LIVE_CLOCK_TAG}\n` +
    `🕐 **London Live Clock**\n` +
    `**Time:** \`${time}\`\n` +
    `**Date:** ${date}\n` +
    `_Updates every minute_`
  );
}

async function setupLiveClock(client: Client, reminderChannelId: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(reminderChannelId);
    if (!(channel instanceof TextChannel)) {
      logger.warn({ reminderChannelId }, "Reminder channel is not a text channel — skipping live clock");
      return;
    }

    // Try to find an existing pinned clock message from a previous run
    let clockMessage: Message | null = null;
    const pinned = await channel.messages.fetchPinned();
    for (const msg of pinned.values()) {
      if (msg.author.id === client.user?.id && msg.content.includes(LIVE_CLOCK_TAG)) {
        clockMessage = msg;
        break;
      }
    }

    // If no pinned clock message found, create one (and try to pin it)
    if (!clockMessage) {
      clockMessage = await channel.send(buildClockMessage());
      try {
        await clockMessage.pin();
        logger.info({ messageId: clockMessage.id }, "Live clock message created and pinned");
      } catch {
        logger.warn(
          { messageId: clockMessage.id },
          "Live clock message created (could not pin — grant bot Manage Messages permission to pin it)",
        );
      }
    } else {
      logger.info({ messageId: clockMessage.id }, "Resuming existing live clock message");
    }

    // Edit the message right away then every minute
    const edit = async (): Promise<void> => {
      try {
        await clockMessage!.edit(buildClockMessage());
        logger.info("Live clock updated");
      } catch (err) {
        logger.error({ err }, "Failed to edit live clock message");
      }
    };

    await edit();
    setInterval(edit, LIVE_CLOCK_INTERVAL_MS);
  } catch (err) {
    logger.error({ err }, "Failed to set up live clock");
  }
}

// ── Main bot entry ──────────────────────────────────────────────

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const channelId = process.env["DISCORD_CHANNEL_ID"];
  const reminderChannelId = process.env["DISCORD_REMINDER_CHANNEL_ID"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
    return;
  }

  if (!channelId) {
    logger.warn("DISCORD_CHANNEL_ID not set — Discord bot will not start");
    return;
  }

  if (!reminderChannelId) {
    logger.warn("DISCORD_REMINDER_CHANNEL_ID not set — reminders will not fire");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  async function updateChannelName(): Promise<void> {
    try {
      const channel = await client.channels.fetch(channelId!);
      if (!channel || !("setName" in channel) || typeof channel.setName !== "function") {
        logger.error({ channelId }, "Channel not found or does not support name changes");
        return;
      }
      const newName = `🕐 London: ${getLondonTimeShort()} (${getLondonDateShort()})`;
      await (channel as { setName: (name: string) => Promise<unknown> }).setName(newName);
      logger.info({ channelId, newName }, "Channel name updated");
    } catch (err) {
      logger.error({ err }, "Failed to update channel name");
    }
  }

  client.once("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Discord bot logged in");

    if (client.user) {
      await registerSlashCommands(token, client.user.id).catch((err) => {
        logger.error({ err }, "Failed to register slash commands");
      });
    }

    await updateChannelName();
    setInterval(updateChannelName, UPDATE_INTERVAL_MS);

    if (reminderChannelId) {
      await fireReminders(client, reminderChannelId);
      setInterval(() => fireReminders(client, reminderChannelId), REMINDER_CHECK_INTERVAL_MS);
      await setupLiveClock(client, reminderChannelId);
    }
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "status") {
      await handleStatusCommand(interaction).catch((err) =>
        logger.error({ err }, "Failed to handle /status"),
      );
      return;
    }

    if (interaction.commandName === "time") {
      await handleTimeCommand(interaction).catch((err) =>
        logger.error({ err }, "Failed to handle /time"),
      );
      return;
    }

    if (interaction.commandName === "worldclock") {
      await handleWorldclockCommand(interaction).catch((err) =>
        logger.error({ err }, "Failed to handle /worldclock"),
      );
      return;
    }

    if (interaction.commandName === "remind") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") await handleRemindAdd(interaction).catch((err) => logger.error({ err }, "Failed to handle /remind add"));
      if (sub === "list") await handleRemindList(interaction).catch((err) => logger.error({ err }, "Failed to handle /remind list"));
      if (sub === "remove") await handleRemindRemove(interaction).catch((err) => logger.error({ err }, "Failed to handle /remind remove"));
      if (sub === "edit") await handleRemindEdit(interaction).catch((err) => logger.error({ err }, "Failed to handle /remind edit"));
    }
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith("!remind")) return;
    await handleReminderMessage(message, reminderChannelId ?? "").catch((err) =>
      logger.error({ err }, "Failed to handle reminder message"),
    );
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
