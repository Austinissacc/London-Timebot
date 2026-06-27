import { Client, GatewayIntentBits } from "discord.js";
import { logger } from "./logger";

const LONDON_TIMEZONE = "Europe/London";
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

function getLondonTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getLondonDate(): string {
  const now = new Date();
  return now.toLocaleDateString("en-GB", {
    timeZone: LONDON_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const channelId = process.env["DISCORD_CHANNEL_ID"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot will not start");
    return;
  }

  if (!channelId) {
    logger.warn("DISCORD_CHANNEL_ID not set — Discord bot will not start");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  async function updateChannelName(): Promise<void> {
    try {
      const channel = await client.channels.fetch(channelId!);
      if (!channel) {
        logger.error({ channelId }, "Channel not found");
        return;
      }

      if (!("setName" in channel) || typeof channel.setName !== "function") {
        logger.error({ channelId }, "Channel does not support name changes");
        return;
      }

      const time = getLondonTime();
      const date = getLondonDate();
      const newName = `🕐 London: ${time} (${date})`;

      await (channel as { setName: (name: string) => Promise<unknown> }).setName(newName);
      logger.info({ channelId, newName }, "Channel name updated");
    } catch (err) {
      logger.error({ err }, "Failed to update channel name");
    }
  }

  client.once("ready", async () => {
    logger.info({ tag: client.user?.tag }, "Discord bot logged in");
    await updateChannelName();
    setInterval(updateChannelName, UPDATE_INTERVAL_MS);
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
