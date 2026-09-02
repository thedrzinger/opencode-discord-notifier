import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, Client, GatewayIntentBits } from "discord.js";
import type { NotifierConfig } from "./config.js";

export type Notifier = {
  send(content: string, components?: ActionRowBuilder<ButtonBuilder>[]): Promise<void>;
  onButtonClick(handler: (interaction: ButtonInteraction) => Promise<void>): void;
  destroy(): Promise<void>;
};

type SendableChannel = { send(payload: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown> };

export async function createDiscordNotifier(config: NotifierConfig): Promise<Notifier> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const ready = new Promise<void>((resolve, reject) => {
    client.once("clientReady", () => resolve());
    client.once("error", reject);
  });

  await client.login(config.discordBotToken);
  await ready;

  let channel: SendableChannel | null = null;

  async function getChannel(): Promise<SendableChannel> {
    if (channel) return channel;
    const fetched = await client.channels.fetch(config.discordChannelId);
    if (!fetched || !fetched.isTextBased() || !("send" in fetched)) {
      throw new Error(
        `opencode-discord-notifier: channel ${config.discordChannelId} is not a text-based channel this bot can send to`,
      );
    }
    channel = fetched as SendableChannel;
    return channel;
  }

  return {
    async send(content: string, components?: ActionRowBuilder<ButtonBuilder>[]) {
      const ch = await getChannel();
      await ch.send({ content, components });
    },
    onButtonClick(handler: (interaction: ButtonInteraction) => Promise<void>) {
      client.on("interactionCreate", (interaction) => {
        if (!interaction.isButton()) return;
        void handler(interaction);
      });
    },
    async destroy() {
      await client.destroy();
    },
  };
}
