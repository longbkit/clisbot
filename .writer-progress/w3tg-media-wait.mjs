// W3-TG case 5 (G7–G11 media outbound, FORUM topic-1): read back the dev-bot
// posts in topic-1. Expect a native photo (the fixture PNG) BEFORE the text
// caption, both at message_thread_id=2, the raw path line stripped from text.
import process from "node:process";
const TOKEN = process.env.TELEGRAM_MASTER_BOT_TOKEN;
const FORUM = process.env.TELEGRAM_TEST_TOPIC_GROUP_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tg(m, p) {
  const r = await fetch(`${API}/${m}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p ?? {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(m + " not ok: " + JSON.stringify(j));
  return j.result;
}
(async () => {
  let offset = 0;
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < 56; i++) {
    await sleep(5000);
    const d = await tg("getUpdates", { offset, limit: 100 });
    offset = d.length ? Math.max(...d.map((u) => u.update_id)) + 1 : offset;
    for (const u of d) {
      const m = u.message ?? {};
      if (m.chat?.id === Number(FORUM) && m.from?.username === "longluong3bot")
        rows.push({
          msg: m.message_id,
          date: m.date,
          thread: m.message_thread_id ?? null,
          text: (m.text ?? "").slice(0, 300),
          photo: !!m.photo,
          document: !!m.document,
          mediaGroup: !!m.media_group_id,
        });
    }
    const hasPong = rows.some((r) => (r.text || "").includes("PONG-TG-W3H"));
    if (hasPong) {
      await sleep(15000); // let any media post that lands with the caption settle
      const d2 = await tg("getUpdates", { offset, limit: 100 });
      offset = d2.length ? Math.max(...d2.map((u) => u.update_id)) + 1 : offset;
      for (const u of d2) {
        const m = u.message ?? {};
        if (m.chat?.id === Number(FORUM) && m.from?.username === "longluong3bot")
          rows.push({
            msg: m.message_id,
            date: m.date,
            thread: m.message_thread_id ?? null,
            text: (m.text ?? "").slice(0, 300),
            photo: !!m.photo,
            document: !!m.document,
          });
      }
      break;
    }
    if (Date.now() - t0 > 280000) break;
  }
  console.log(
    `dev-bot topic-1 posts over ${Math.round((Date.now() - t0) / 1000)}s (in date order):`,
  );
  const sorted = [...rows].sort((a, b) => a.date - b.date || (a.msg ?? 0) - (b.msg ?? 0));
  for (const r of sorted)
    console.log(
      `  msg ${r.msg} @${r.date} thread=${r.thread} photo=${r.photo} doc=${r.document} :: ${JSON.stringify(r.text)}`,
    );
  const photo = sorted.find((r) => r.photo || r.document);
  const caption = sorted.find((r) => (r.text || "").includes("PONG-TG-W3H"));
  const mediaBeforeText =
    photo && caption
      ? photo.date < caption.date ||
        (photo.date === caption.date && (photo.msg ?? 0) < (caption.msg ?? 0))
      : null;
  const pathLeaked = caption
    ? /\/home\/node\/\.clisbot-dev\/workspace\/w3-media/.test(caption.text || "")
    : null;
  console.log(
    JSON.stringify(
      {
        native_media_post: photo ?? null,
        caption_post: caption ?? null,
        media_in_topic1: photo ? photo.thread === 2 : null,
        caption_in_topic1: caption ? caption.thread === 2 : null,
        media_before_text: mediaBeforeText,
        raw_path_stripped_from_caption: caption ? !pathLeaked : null,
      },
      null,
      1,
    ),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
