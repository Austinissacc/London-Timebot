import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionsBitField,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  Role,
  Guild,
} from "discord.js";
import { logger } from "./logger";

// ── Permission guard ─────────────────────────────────────────────

function requireAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (!member || !("permissions" in member)) return false;
  const perms = member.permissions;
  if (typeof perms === "string") return false;
  return (
    perms.has(PermissionsBitField.Flags.Administrator) ||
    perms.has(PermissionsBitField.Flags.ManageGuild)
  );
}

async function denyAccess(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "❌ You need **Administrator** or **Manage Server** permission to use this command.",
    ephemeral: true,
  });
}

// ── Command definition ───────────────────────────────────────────

export const adminCommand = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Server administration commands")
  .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName("serverinfo").setDescription("Show server statistics and information"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("userinfo")
      .setDescription("Show a member's roles, join date, and account info")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("The member to look up").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("announce")
      .setDescription("Broadcast an announcement to any channel")
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("Channel to post in").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("message").setDescription("The announcement text").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("purge")
      .setDescription("Bulk-delete the last N messages in this channel")
      .addIntegerOption((opt) =>
        opt
          .setName("amount")
          .setDescription("Number of messages to delete (1–100)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("kick")
      .setDescription("Kick a member from the server")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("The member to kick").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason (optional)").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ban")
      .setDescription("Ban a member from the server")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("The member to ban").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason (optional)").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("unban")
      .setDescription("Unban a user by their Discord ID")
      .addStringOption((opt) =>
        opt.setName("userid").setDescription("The user ID to unban").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("timeout")
      .setDescription("Temporarily mute a member")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("The member to timeout").setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Duration in minutes (1–40320, i.e. up to 28 days)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(40320),
      )
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason (optional)").setRequired(false),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("role")
      .setDescription("Add or remove roles from a member")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a role to a member")
          .addUserOption((opt) =>
            opt.setName("user").setDescription("The member").setRequired(true),
          )
          .addRoleOption((opt) =>
            opt.setName("role").setDescription("The role to add").setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Remove a role from a member")
          .addUserOption((opt) =>
            opt.setName("user").setDescription("The member").setRequired(true),
          )
          .addRoleOption((opt) =>
            opt.setName("role").setDescription("The role to remove").setRequired(true),
          ),
      ),
  );

// ── Handlers ─────────────────────────────────────────────────────

async function handleServerInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const guild = interaction.guild as Guild;
  await guild.fetch();

  const owner = await guild.fetchOwner().catch(() => null);
  const memberCount = guild.memberCount;
  const roleCount = guild.roles.cache.size;
  const channelCount = guild.channels.cache.size;
  const emojiCount = guild.emojis.cache.size;
  const createdAt = guild.createdAt.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const boostLevel = guild.premiumTier;
  const boostCount = guild.premiumSubscriptionCount ?? 0;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${guild.name}`)
    .setThumbnail(guild.iconURL())
    .setColor(0x5865f2)
    .addFields(
      { name: "👤 Owner", value: owner ? `<@${owner.id}>` : "Unknown", inline: true },
      { name: "👥 Members", value: `${memberCount}`, inline: true },
      { name: "📅 Created", value: createdAt, inline: true },
      { name: "🎭 Roles", value: `${roleCount}`, inline: true },
      { name: "💬 Channels", value: `${channelCount}`, inline: true },
      { name: "😀 Emojis", value: `${emojiCount}`, inline: true },
      { name: "🚀 Boost Level", value: `Level ${boostLevel} (${boostCount} boosts)`, inline: true },
      { name: "🆔 Server ID", value: guild.id, inline: true },
    )
    .setFooter({ text: "Server Info" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleUserInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const member = interaction.options.getMember("user") as GuildMember | null;

  const joinedAt = member?.joinedAt?.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  }) ?? "Unknown";

  const createdAt = user.createdAt.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const roles = member?.roles.cache
    .filter((r: Role) => r.id !== interaction.guild?.id)
    .map((r: Role) => `<@&${r.id}>`)
    .join(", ") || "None";

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${user.displayName}`)
    .setThumbnail(user.displayAvatarURL())
    .setColor(0x57f287)
    .addFields(
      { name: "🏷️ Username", value: user.tag, inline: true },
      { name: "🆔 User ID", value: user.id, inline: true },
      { name: "🤖 Bot", value: user.bot ? "Yes" : "No", inline: true },
      { name: "📅 Account Created", value: createdAt, inline: true },
      { name: "📥 Joined Server", value: joinedAt, inline: true },
      { name: "🎭 Roles", value: roles.length > 1024 ? roles.slice(0, 1021) + "..." : roles },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleAnnounce(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const channelOption = interaction.options.getChannel("channel", true);
  const messageText = interaction.options.getString("message", true);

  const channel = interaction.guild?.channels.cache.get(channelOption.id);
  if (!(channel instanceof TextChannel)) {
    await interaction.reply({ content: "❌ That channel is not a text channel.", ephemeral: true });
    return;
  }

  await channel.send(
    `📢 **Announcement**\n\n${messageText}\n\n— <@${interaction.user.id}>`,
  );

  await interaction.reply({
    content: `✅ Announcement posted in <#${channel.id}>`,
    ephemeral: true,
  });

  logger.info({ channelId: channel.id, adminId: interaction.user.id }, "Announcement posted");
}

async function handlePurge(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const amount = interaction.options.getInteger("amount", true);
  const channel = interaction.channel;

  if (!(channel instanceof TextChannel)) {
    await interaction.reply({ content: "❌ This command can only be used in text channels.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const deleted = await channel.bulkDelete(amount, true);

  await interaction.editReply({
    content: `🗑️ Deleted **${deleted.size}** message${deleted.size !== 1 ? "s" : ""}.${
      deleted.size < amount ? `\n_Note: ${amount - deleted.size} messages were too old to delete (>14 days)._` : ""
    }`,
  });

  logger.info({ channelId: channel.id, count: deleted.size, adminId: interaction.user.id }, "Messages purged");
}

async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") ?? "No reason provided";
  const member = interaction.options.getMember("user") as GuildMember | null;

  if (!member) {
    await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ content: "❌ I don't have permission to kick that member (they may outrank me).", ephemeral: true });
    return;
  }

  await member.kick(reason);
  await interaction.reply({ content: `👢 **${user.tag}** has been kicked.\n📋 Reason: ${reason}` });
  logger.info({ targetId: user.id, reason, adminId: interaction.user.id }, "Member kicked");
}

async function handleBan(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") ?? "No reason provided";
  const member = interaction.options.getMember("user") as GuildMember | null;

  if (member && !member.bannable) {
    await interaction.reply({ content: "❌ I don't have permission to ban that member (they may outrank me).", ephemeral: true });
    return;
  }

  await interaction.guild?.members.ban(user.id, { reason });
  await interaction.reply({ content: `🔨 **${user.tag}** has been banned.\n📋 Reason: ${reason}` });
  logger.info({ targetId: user.id, reason, adminId: interaction.user.id }, "Member banned");
}

async function handleUnban(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const userId = interaction.options.getString("userid", true).trim();

  try {
    await interaction.guild?.members.unban(userId);
    await interaction.reply({ content: `✅ User **${userId}** has been unbanned.`, ephemeral: true });
    logger.info({ targetId: userId, adminId: interaction.user.id }, "Member unbanned");
  } catch {
    await interaction.reply({ content: `❌ Could not unban user ID \`${userId}\`. Make sure the ID is correct and they are actually banned.`, ephemeral: true });
  }
}

async function handleTimeout(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason") ?? "No reason provided";
  const member = interaction.options.getMember("user") as GuildMember | null;

  if (!member) {
    await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true });
    return;
  }

  if (!member.moderatable) {
    await interaction.reply({ content: "❌ I don't have permission to timeout that member.", ephemeral: true });
    return;
  }

  const durationMs = minutes * 60 * 1000;
  await member.timeout(durationMs, reason);

  const durationLabel = minutes >= 1440
    ? `${Math.floor(minutes / 1440)}d ${minutes % 1440 > 0 ? `${Math.floor((minutes % 1440) / 60)}h` : ""}`.trim()
    : minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60 > 0 ? `${minutes % 60}m` : ""}`.trim()
    : `${minutes}m`;

  await interaction.reply({
    content: `🔇 **${user.tag}** has been timed out for **${durationLabel}**.\n📋 Reason: ${reason}`,
  });
  logger.info({ targetId: user.id, minutes, reason, adminId: interaction.user.id }, "Member timed out");
}

async function handleRoleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const role = interaction.options.getRole("role", true) as Role;
  const member = interaction.options.getMember("user") as GuildMember | null;

  if (!member) {
    await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: `⚠️ **${user.tag}** already has the <@&${role.id}> role.`, ephemeral: true });
    return;
  }

  await member.roles.add(role);
  await interaction.reply({ content: `✅ Added <@&${role.id}> to **${user.tag}**.`, ephemeral: true });
  logger.info({ targetId: user.id, roleId: role.id, adminId: interaction.user.id }, "Role added");
}

async function handleRoleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!requireAdmin(interaction)) { await denyAccess(interaction); return; }

  const user = interaction.options.getUser("user", true);
  const role = interaction.options.getRole("role", true) as Role;
  const member = interaction.options.getMember("user") as GuildMember | null;

  if (!member) {
    await interaction.reply({ content: "❌ That user is not in this server.", ephemeral: true });
    return;
  }

  if (!member.roles.cache.has(role.id)) {
    await interaction.reply({ content: `⚠️ **${user.tag}** doesn't have the <@&${role.id}> role.`, ephemeral: true });
    return;
  }

  await member.roles.remove(role);
  await interaction.reply({ content: `✅ Removed <@&${role.id}> from **${user.tag}**.`, ephemeral: true });
  logger.info({ targetId: user.id, roleId: role.id, adminId: interaction.user.id }, "Role removed");
}

// ── Main dispatcher ──────────────────────────────────────────────

export async function handleAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === "role") {
    if (sub === "add") return handleRoleAdd(interaction);
    if (sub === "remove") return handleRoleRemove(interaction);
    return;
  }

  switch (sub) {
    case "serverinfo": return handleServerInfo(interaction);
    case "userinfo":   return handleUserInfo(interaction);
    case "announce":   return handleAnnounce(interaction);
    case "purge":      return handlePurge(interaction);
    case "kick":       return handleKick(interaction);
    case "ban":        return handleBan(interaction);
    case "unban":      return handleUnban(interaction);
    case "timeout":    return handleTimeout(interaction);
  }
}
