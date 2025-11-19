import { getStore } from "@netlify/blobs";

export async function handler(event) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  try {
    const store = getStore("events");
    async function readAll() {
      const txt = await store.get("events.json", { type: "text" });
      if (!txt) return [];
      try { return JSON.parse(txt); } catch { return []; }
    }
    async function writeAll(arr) {
      await store.set("events.json", JSON.stringify(arr));
    }

    if (event.httpMethod === "GET") {
      const data = await readAll();
      return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, data }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = body.action;
      const list = await readAll();

      if (action === "add" && body.event) {
        list.push(body.event);
        await writeAll(list);
        return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
      }

      if (action === "replace" && Array.isArray(body.events)) {
        await writeAll(body.events);
        return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
      }

      if (action === "join" && typeof body.id !== "undefined") {
        const idStr = String(body.id);
        const d = Number(body.delta) || 0;
        const out = list.map(e => String(e.id) === idStr ? { ...e, partecipanti: Math.max(0, Number(e.partecipanti||0) + d) } : e);
        await writeAll(out);
        return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: cors, body: "Bad Request" };
    }

    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: String(e && e.message || e) };
  }
}
