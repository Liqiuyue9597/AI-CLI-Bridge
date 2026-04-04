import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "..", ".env");

interface Config {
  // 平台
  enableDiscord: boolean;
  discordToken?: string;
  discordAppId?: string;
  // 飞书
  enableLark: boolean;
  larkAppId?: string;
  larkAppSecret?: string;
  // 安全
  allowedUsers?: string;
  skipPermissions: boolean;
  // CLI
  cliPath: string;
  workDir: string;
}

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(rl, `${question} ${hint}: `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

function generateEnv(config: Config): string {
  const lines: string[] = [
    "# ═══ AI CLI Bridge 配置 ═══",
    `# 由 npm run setup 生成于 ${new Date().toLocaleString()}`,
    "",
  ];

  // Discord
  if (config.enableDiscord) {
    lines.push("# ── Discord ──");
    lines.push(`DISCORD_TOKEN=${config.discordToken || ""}`);
    lines.push(`DISCORD_APP_ID=${config.discordAppId || ""}`);
    lines.push("");
  }

  // 飞书
  if (config.enableLark) {
    lines.push("# ── 飞书 ──");
    lines.push(`LARK_APP_ID=${config.larkAppId || ""}`);
    lines.push(`LARK_APP_SECRET=${config.larkAppSecret || ""}`);
    lines.push("");
  }

  // 安全
  lines.push("# ── 安全 ──");
  if (config.allowedUsers) {
    lines.push(`ALLOWED_USERS=${config.allowedUsers}`);
  } else {
    lines.push("# ALLOWED_USERS=user_id_1,user_id_2");
  }
  lines.push(`SKIP_PERMISSIONS=${config.skipPermissions}`);
  lines.push("");

  // 通用
  lines.push("# ── AI CLI 工具 ──");
  lines.push(`CLI_PATH=${config.cliPath}`);
  lines.push(`CLAUDE_WORK_DIR=${config.workDir}`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const rl = createRL();

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  AI CLI Bridge 初始化配置向导");
  console.log("═══════════════════════════════════════════");
  console.log("");

  // 检查是否已有 .env
  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await askYesNo(rl, "检测到已有 .env 配置，是否覆盖？", false);
    if (!overwrite) {
      console.log("已取消。");
      rl.close();
      return;
    }
    console.log("");
  }

  const config: Config = {
    enableDiscord: false,
    enableLark: false,
    skipPermissions: false,
    cliPath: "claude",
    workDir: process.cwd(),
  };

  // ── 选择平台 ──────────────────────────────────────────────
  console.log("📡 选择要连接的平台：");
  console.log("");

  config.enableDiscord = await askYesNo(rl, "  启用 Discord？");
  config.enableLark = await askYesNo(rl, "  启用飞书？");

  if (!config.enableDiscord && !config.enableLark) {
    console.log("\n⚠️  至少需要启用一个平台！");
    rl.close();
    return;
  }

  // ── Discord 配置 ──────────────────────────────────────────
  if (config.enableDiscord) {
    console.log("");
    console.log("── Discord 配置 ──");
    console.log("  (从 https://discord.com/developers/applications 获取)");
    console.log("");
    config.discordAppId = await ask(rl, "  Application ID: ");
    config.discordToken = await ask(rl, "  Bot Token: ");
  }

  // ── 飞书配置 ──────────────────────────────────────────────
  if (config.enableLark) {
    console.log("");
    console.log("── 飞书配置 ──");
    console.log("  (从 https://open.feishu.cn/app 获取)");
    console.log("");
    config.larkAppId = await ask(rl, "  App ID: ");
    config.larkAppSecret = await ask(rl, "  App Secret: ");
  }

  // ── 安全配置 ──────────────────────────────────────────────
  console.log("");
  console.log("── 安全配置 ──");
  console.log("");
  console.log("  ⚠️  强烈建议配置用户白名单，限制谁可以通过 Bot 控制你的电脑");
  console.log("");
  console.log("  如何获取用户 ID：");
  if (config.enableDiscord) {
    console.log("    Discord: 设置 → 高级 → 打开「开发者模式」，然后右键自己的头像 → 复制用户 ID");
  }
  if (config.enableLark) {
    console.log("    飞书:    Open ID (ou_xxx) 无法在后台直接查看，请先留空，");
    console.log("             启动 Bot 后给它发 whoami 即可获取你的 Open ID");
  }
  console.log("");

  const allowedUsers = await ask(rl, "  允许的用户 ID（逗号分隔，留空则不限制）: ");
  if (allowedUsers) {
    config.allowedUsers = allowedUsers;
  }

  config.skipPermissions = await askYesNo(
    rl,
    "  跳过 Claude 权限检查？（危险！仅在你信任所有用户时启用）",
    false
  );

  // ── CLI 工具配置 ──────────────────────────────────────────
  console.log("");
  console.log("── AI CLI 工具配置 ──");
  console.log("");
  console.log("  支持的 CLI 工具：");
  console.log("    1) claude           (Claude Code CLI)");
  console.log("    2) codex            (OpenAI Codex CLI)");
  console.log("    3) gemini           (Google Gemini CLI)");
  console.log("    4) 自定义（手动输入 CLI 名称或路径）");
  console.log("");

  const cliChoice = await ask(rl, "  选择 CLI 工具 [1-4，默认 1]: ");

  switch (cliChoice) {
    case "2": config.cliPath = "codex"; break;
    case "3": config.cliPath = "gemini"; break;
    case "4": {
      const custom = await ask(rl, "  输入 CLI 名称或可执行文件路径: ");
      if (custom) config.cliPath = custom;
      break;
    }
    default: config.cliPath = "claude"; break;
  }

  console.log(`  ✓ 使用: ${config.cliPath}`);
  console.log("");

  const defaultWorkDir = process.env.HOME || process.cwd();
  const workDir = await ask(rl, `  工作目录 [${defaultWorkDir}]: `);
  config.workDir = workDir || defaultWorkDir;

  // ── 生成配置 ──────────────────────────────────────────────
  const envContent = generateEnv(config);

  console.log("");
  console.log("── 配置预览 ──");
  console.log("");
  console.log(envContent);

  const confirm = await askYesNo(rl, "确认写入 .env？");
  if (confirm) {
    fs.writeFileSync(ENV_PATH, envContent, "utf-8");
    console.log("");
    console.log("✅ 配置已保存到 .env");
    console.log("");
    console.log("启动服务：");
    console.log("  npm start        # 启动");
    console.log("  npm run dev      # 开发模式（热重载）");
    console.log("  pm2 start \"npx tsx src/index.ts\" --name ai-cli-bridge  # 后台保活");
    console.log("");
  } else {
    console.log("已取消。");
  }

  rl.close();
}

main().catch((err) => {
  console.error("初始化失败:", err);
  process.exit(1);
});
