import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

/**
 * 定义所有斜杠命令
 */

export const ASK_COMMAND = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("开始一个新的 Claude 对话")
  .addStringOption((option) =>
    option
      .setName("prompt")
      .setDescription("你想问 Claude 的问题")
      .setRequired(true)
  );

export const CHAT_COMMAND = new SlashCommandBuilder()
  .setName("chat")
  .setDescription("在当前对话中继续和 Claude 聊天（保持上下文）")
  .addStringOption((option) =>
    option
      .setName("prompt")
      .setDescription("你想说的内容")
      .setRequired(true)
  );

export const RESET_COMMAND = new SlashCommandBuilder()
  .setName("reset")
  .setDescription("重置当前对话，清除聊天记忆");

export const STATUS_COMMAND = new SlashCommandBuilder()
  .setName("status")
  .setDescription("查看当前会话状态");

/**
 * 所有命令的 JSON 定义（用于注册）
 */
export const ALL_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  ASK_COMMAND.toJSON(),
  CHAT_COMMAND.toJSON(),
  RESET_COMMAND.toJSON(),
  STATUS_COMMAND.toJSON(),
];
