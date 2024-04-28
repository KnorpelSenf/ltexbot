import {
  Bot,
  InlineKeyboard,
  InlineQueryResultBuilder,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.22.4/mod.ts";
import { run } from "https://deno.land/x/grammy_runner@v2.0.3/mod.ts";

// LaTeX Rendering Code
const CONVERSION_URL =
  "https://e1kf0882p7.execute-api.us-east-1.amazonaws.com/default/latex2image";
export async function render(eq: string): Promise<string | undefined> {
  const aligned = `\\begin{align*}\n${eq}\n\\end{align*}\n`;
  const body = JSON.stringify({
    latexInput: aligned,
    outputFormat: "JPG",
    outputScale: "1000%",
  });
  const res = await fetch(CONVERSION_URL, { method: "POST", body });
  if (res.status >= 500) return undefined;
  const rendered: { imageUrl: string } = await res.json();
  return rendered.imageUrl;
}

// Bot Code
const token = Deno.env.get("BOT_TOKEN");
if (!token) throw "Missing BOT_TOKEN!";
const bot = new Bot(token);

function editKeyboard(eq: string | undefined): InlineKeyboard | undefined {
  if (!eq) return undefined;
  return new InlineKeyboard().url(
    "LaTeX",
    "https://t.me/" + bot.botInfo.username + "?start=" + btoa(eq),
  );
}

bot.command("start")
  .branch(
    (ctx) => !!ctx.match,
    async (ctx) => {
      const eq = atob(ctx.match);
      if (eq) {
        await ctx.reply(eq, {
          entities: [{ type: "code", offset: 0, length: eq.length }],
        });
      }
    },
    (ctx) =>
      ctx.reply("Hi! I can render LaTeX formulas to images!", {
        reply_markup: new InlineKeyboard()
          .switchInlineCurrent("try it").row()
          .switchInline("send it"),
      }),
  );

bot.command("help", (ctx) =>
  ctx.reply(
    `I can render LaTeX to images.

RENDERING is always done inside an align* environment.

INPUT is read from
  - inline queries (typing @${ctx.me.username} …)
  - text messages in a private chat
  - code/pre formatting inside text messages in a group chat if the formatted pieces of text are surrounded by $ signs

SOURCE is available at github.com/KnorpelSenf/ltexbot

CREDIT goes to latex2image.joeraut.com and grammy.dev`,
    { link_preview_options: { is_disabled: true } },
  ));

bot.on("inline_query", async (ctx) => {
  const eq = ctx.inlineQuery.query;
  if (!eq) {
    await ctx.answerInlineQuery([]);
    return;
  }

  const file = await render(eq);
  if (file === undefined) {
    await ctx.answerInlineQuery([
      InlineQueryResultBuilder
        .article("err", "Invalid LaTeX", { description: eq })
        .text(eq),
    ]);
    return;
  }

  const result = InlineQueryResultBuilder.photo("0", file, {
    thumbnail_url: file,
    reply_markup: editKeyboard(eq),
  });
  await ctx.answerInlineQuery([result]);
});

const noSelf = bot.drop((ctx) => ctx.msg?.via_bot?.id === ctx.me.id);

noSelf.chatType("private").on(":text", async (ctx) => {
  const eq = ctx.msg.text;

  const file = await render(eq);
  if (file === undefined) {
    await ctx.reply(
      "This is invalid LaTeX and could not be rendered",
      { reply_parameters: { message_id: ctx.msg.message_id } },
    );
    return;
  }

  await ctx.replyWithPhoto(file);
});

noSelf.chatType(["group", "supergroup"]).on(":text", async (ctx) => {
  const code = ctx.entities("code")
    .filter((e) => e.text.startsWith("$") && e.text.endsWith("$"))
    .map((e) => e.text.substring(1, e.text.length - 1));
  const files = (await Promise
    .all(code.map(async (eq) => ({ eq, media: await render(eq) }))))
    .filter((f): f is { eq: string; media: string } => f.media !== undefined);
  switch (files.length) {
    case 0:
      return;
    case 1: {
      const { eq, media } = files[0];
      await ctx.replyWithPhoto(media, {
        reply_parameters: { message_id: ctx.msg.message_id },
        reply_markup: editKeyboard(eq),
      });
      return;
    }
    default: {
      await ctx.replyWithMediaGroup(
        files.slice(0, 10).map(({ media }) => ({ type: "photo", media })),
        { reply_parameters: { message_id: ctx.msg.message_id } },
      );
      return;
    }
  }
});

if (Deno.env.get("DEBUG")) {
  bot.catch((err) => console.error(err));
  run(bot);
} else {
  Deno.serve(webhookCallback(bot, "std/http", { secretToken: token }));
}
