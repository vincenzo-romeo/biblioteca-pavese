import React, { useEffect, useMemo, useRef, useState } from "react";

// App.tsx – Biblioteca "Cesare Pavese" – Brancaleone (RC)
// Frontend completo con:
// - Prestito libri via email (campi obbligatori: email e telefono)
// - Eventi: inserimento admin, upload/URL locandina (ridimensionamento client), Partecipo (contatore), Elimina (solo admin)
// - Import/Export JSON (modale, copia/download)
// - Sync globale: polling ogni 20s + stato rete (Netlify Functions + KV)
// Endpoint predefinito: /.netlify/functions/events → redirect a events-kv (configurato in netlify.toml)

// =============================
// Tipi e utilità
// =============================
type Ev = {
  id: number;
  titolo: string;
  data: string; // ISO
  luogo: string;
  descrizione?: string;
  link?: string;
  poster?: string; // dataURL o URL
  partecipanti?: number;
};

function toISODateSafe(value?: string | null) {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(+d)) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function stripBOM(s: string) {
  try {
    // Rimuove l'eventuale BOM (Byte Order Mark)
    return s.replace(/^\\uFEFF/, "");
  } catch {
    return s;
  }
}

function normalizeJsonText(s: string) {
  try {
    // Normalizza virgolette tipografiche, spazi non separabili e newline
    return s
      .replace(/[\\u201C\\u201D\\u00AB\\u00BB]/g, '"')
      .replace(/[\\u2018\\u2019]/g, "'")
      .replace(/\\u00A0/g, " ")
      .replace(/\\r?\\n/g, "\\n");
  } catch {
    return s;
  }
}

function useImageSrc(filename: string) {
  const candidates = useMemo(
    () => [`./${filename}`, `/${filename}`, `/images/${filename}`, `/assets/${filename}`],
    [filename]
  );
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      for (const path of candidates) {
        const ok = await new Promise<boolean>((res) => {
          const img = new Image();
          img.onload = () => res(true);
          img.onerror = () => res(false);
          img.src = path;
        });
        if (ok && !cancel) {
          setSrc(path);
          break;
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [candidates]);
  return src;
}

// =============================
// Componente principale
// =============================
export default function App() {
  // --- Config ---
  const ADMIN_KEY = "biblioteca_admin_ok";
  const ADMIN_PASSWORD = "pavese2025"; // cambia in produzione
  const LOCAL_EVENTS_KEY = "biblioteca_events_local";
  const PSET_KEY = "biblioteca_eventi_partecipazioni";

  const API: string = (import.meta as any)?.env?.VITE_EVENTS_API ?? "/.netlify/functions/events";
  const ONLINE = !!API;

  const bannerSrc = useImageSrc("Cesare_Pavese.jpg"); // opzionale

  // --- Stato admin ---
  const [admin, setAdmin] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ADMIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [showLogin, setShowLogin] = useState(false);
  const [pwd, setPwd] = useState("");

  // --- Prestito libri ---
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    telefono: "",
    autore: "",
    titolo: "",
  });
  const [messaggio, setMessaggio] = useState("");

  // --- Eventi ---
  const [eventsLocal, setEventsLocal] = useState<Ev[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_EVENTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const persistLocal = (arr: Ev[]) => {
    const norm = (arr || []).map((e) => ({
      ...e,
      partecipanti: Number.isFinite(e.partecipanti) ? (e.partecipanti as number) : 0,
    }));
    setEventsLocal(norm);
    try {
      localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(norm));
    } catch {}
  };

  const [joinedIds, setJoinedIds] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PSET_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const persistJoined = (ids: number[]) => {
    setJoinedIds(ids);
    try {
      localStorage.setItem(PSET_KEY, JSON.stringify(ids));
    } catch {}
  };

  const [draft, setDraft] = useState<Ev>({
    id: 0,
    titolo: "",
    data: "",
    luogo: "",
    descrizione: "",
    link: "",
    poster: "",
    partecipanti: 0,
  });
  const [posterPreview, setPosterPreview] = useState("");

  // --- Modale conferma elimina ---
  const [confirmDel, setConfirmDel] = useState<{ open: boolean; id: null | number | string; title: string }>(
    { open: false, id: null, title: "" }
  );
  const askDelete = (ev: Ev) => setConfirmDel({ open: true, id: ev.id, title: ev.titolo || "evento" });
  const cancelDelete = () => setConfirmDel({ open: false, id: null, title: "" });
  const confirmDelete = async () => {
    if (confirmDel.id == null) return;
    await deleteEvent(confirmDel.id);
    cancelDelete();
  };

  // --- Upload/Ridimensionamento locandina ---
  const onPosterFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert(`Seleziona un'immagine.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const img = new Image();
        img.onload = () => {
          const maxW = 1200,
            maxH = 1200;
          let w = img.width,
            h = img.height;
          const ratio = Math.min(maxW / w, maxH / h, 1);
          if (ratio < 1) {
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0, w, h);
            const out = canvas.toDataURL("image/jpeg", 0.85);
            setDraft((p) => ({ ...p, poster: out }));
            setPosterPreview(out);
          } else {
            setDraft((p) => ({ ...p, poster: dataUrl }));
            setPosterPreview(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    } catch {
      alert(`Impossibile caricare l'immagine.`);
    }
  };
  const clearPoster = () => {
    setDraft((p) => ({ ...p, poster: "" }));
    setPosterPreview("");
  };

  // --- Stato rete + sincronizzazione globale ---
  const [netStatus, setNetStatus] = useState<'online' | 'offline' | 'error'>("offline");
  const [lastSync, setLastSync] = useState<string>("");

  useEffect(() => {
    if (!ONLINE) return;
    (async () => {
      try {
        const r = await fetch(API, { method: 'GET' });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if ((j as any)?.ok && Array.isArray((j as any).data)) {
          persistLocal((j as any).data as Ev[]);
          setNetStatus('online');
          setLastSync(new Date().toLocaleString('it-IT'));
        } else {
          setNetStatus('error');
        }
      } catch { setNetStatus('error'); }
    })();
  }, [API, ONLINE]);

  useEffect(() => {
    if (!ONLINE) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(API, { method: 'GET', cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if ((j as any)?.ok && Array.isArray((j as any).data)) {
          persistLocal((j as any).data as Ev[]);
          setNetStatus('online');
          setLastSync(new Date().toLocaleString('it-IT'));
        }
      } catch {}
    }, 20000);
    return () => clearInterval(id);
  }, [API, ONLINE]);

  // --- Ripara struttura eventi ---
  const autoRepair = async () => {
    try {
      const list = Array.isArray(eventsLocal) ? eventsLocal : [];
      const seen = new Set<number>();
      const fix = (ev: any) => {
        const out: any = { ...ev };
        out.titolo = (out.titolo || '').toString().trim() || 'Senza titolo';
        out.luogo = (out.luogo || (out as any).luogo_evento || '').toString().trim() || '—';
        const iso = toISODateSafe(out.data) || toISODateSafe((out as any).datetime);
        out.data = iso || (out.data || (out as any).datetime || new Date().toISOString());
        const n = Number(out.partecipanti);
        out.partecipanti = Number.isFinite(n) && n >= 0 ? n : 0;
        let id = Number(out.id);
        if (!Number.isFinite(id)) id = Date.now() + Math.floor(Math.random() * 1000);
        while (seen.has(id)) id += 1;
        out.id = id;
        seen.add(id);
        return out;
      };
      const repaired = list.map(fix);
      if (!window.confirm(`Applicare la riparazione a ${repaired.length} evento/i?`)) return;
      persistLocal(repaired);
      if (ONLINE) {
        try {
          await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'replace', events: repaired }),
          });
        } catch {}
      }
      alert(`Riparazione completata.`);
    } catch (e: any) {
      alert(`Errore riparazione: ${e?.message || e}`);
    }
  };

  // --- Aggiungi evento ---
  const addLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    const titolo = (draft.titolo || '').trim();
    const luogo = (draft.luogo || '').trim();
    const iso = toISODateSafe(draft.data);
    if (!titolo || !luogo || !iso) {
      alert(`Compila Titolo, Data valida e Luogo.`);
      return;
    }
    const ev: Ev = {
      id: Date.now(),
      titolo,
      luogo,
      data: iso,
      descrizione: draft.descrizione || '',
      link: draft.link || '',
      poster: draft.poster || '',
      partecipanti: 0,
    };
    persistLocal([...(eventsLocal || []), ev]);
    if (ONLINE) {
      try {
        await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', event: ev }),
        });
      } catch {}
    }
    setDraft({ id: 0, titolo: '', data: '', luogo: '', descrizione: '', link: '', poster: '', partecipanti: 0 });
    setPosterPreview('');
  };

  // --- Elimina evento (solo admin) ---
  const deleteEvent = async (id: number | string) => {
    try {
      const targetStr = String(id);
      const targetNum = Number(id);
      let filteredRef: Ev[] = [];
      setEventsLocal((current) => {
        const next = (current || []).filter((e) => {
          const asStr = String(e.id);
          const asNum = Number(e.id);
          return !(asStr === targetStr || (Number.isFinite(targetNum) && Number.isFinite(asNum) && asNum === targetNum));
        });
        filteredRef = next;
        try {
          localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      if (Number.isFinite(targetNum)) {
        setJoinedIds((cur) => {
          const next = cur.filter((x) => x !== targetNum);
          try {
            localStorage.setItem(PSET_KEY, JSON.stringify(next));
          } catch {}
          return next;
        });
      }
      if (ONLINE) {
        try {
          await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'replace', events: filteredRef }),
          });
        } catch {}
      }
      if (!filteredRef || filteredRef.length === (eventsLocal?.length ?? 0)) {
        alert(`Impossibile eliminare: evento non trovato. Esegui "Ripara automaticamente".`);
      }
    } catch (e: any) {
      alert(`Errore durante l'eliminazione: ${e?.message || e}`);
    }
  };

  // --- Partecipa / Annulla ---
  const toggleJoin = async (evId: number) => {
    const joined = joinedIds.includes(evId);
    const updated = (eventsLocal || []).map((e) =>
      e.id !== evId
        ? e
        : ({
            ...e,
            partecipanti: Math.max(0, (Number.isFinite(e.partecipanti) ? (e.partecipanti as number) : 0) + (joined ? -1 : +1)),
          } as Ev)
    );
    persistLocal(updated);
    persistJoined(joined ? joinedIds.filter((id) => id !== evId) : [...joinedIds, evId]);
    if (ONLINE) {
      try {
        await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join', id: evId, delta: joined ? -1 : +1 }),
        });
      } catch {}
    }
  };

  // --- Ordinamento eventi ---
  const upcoming = (eventsLocal || [])
    .slice()
    .sort((a, b) => {
      const ta = +new Date(a.data);
      const tb = +new Date(b.data);
      return (isNaN(ta) ? Infinity : ta) - (isNaN(tb) ? Infinity : tb);
    });

  // --- Export/Import JSON ---
  const [exportReadyUrl, setExportReadyUrl] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const jsonAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showImportText, setShowImportText] = useState(false);
  const [importText, setImportText] = useState("");

  const prepareExport = () => {
    try {
      const payload = JSON.stringify(eventsLocal || [], null, 2);
      const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(payload);
      setExportReadyUrl(dataUrl);
      setJsonText(payload);
      setShowJson(true);
    } catch (err: any) {
      alert(`Errore durante la generazione del file: ${err?.message || err}`);
    }
  };

  const importFromText = async () => {
    try {
      const raw0 = importText.trim();
      if (!raw0) {
        alert(`Incolla del JSON valido.`);
        return;
      }
      const raw = stripBOM(normalizeJsonText(raw0));
      const json = JSON.parse(raw);
      const arr = Array.isArray(json)
        ? json
        : Array.isArray((json as any)?.events)
        ? (json as any).events
        : Array.isArray((json as any)?.data)
        ? (json as any).data
        : null;
      if (!Array.isArray(arr)) {
        alert(`Formato JSON non valido: atteso array o {events:[...]} o {data:[...]}. `);
        return;
      }
      const normalize = (ev: any): Ev => {
        const idNum = Number(ev.id);
        return {
          id: Number.isFinite(idNum) ? Math.trunc(idNum) : Math.trunc(Date.now() + Math.random() * 1000),
          titolo: ev.titolo || "Senza titolo",
          data: toISODateSafe(ev.data as string) || toISODateSafe(ev.datetime as string) || (ev.data || ev.datetime || ''),
          luogo: ev.luogo || ev.luogo_evento || "",
          descrizione: ev.descrizione || ev.description || "",
          link: ev.link || ev.url || "",
          poster: ev.poster || ev.image || "",
          partecipanti: Number.isFinite(Number(ev.partecipanti)) ? Number(ev.partecipanti) : 0,
        };
      };
      const imported: Ev[] = (arr as any[]).map(normalize);
      if (!window.confirm(`Sostituire completamente gli eventi con ${imported.length} elemento/i dal testo?`)) return;
      persistLocal(imported);
      if (ONLINE) {
        try {
          await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'replace', events: imported }),
          });
        } catch {}
      }
      setShowImportText(false);
      setImportText("");
      alert(`Import da testo completato. Eventi totali ora: ${imported.length}.`);
    } catch (err: any) {
      alert(`JSON non valido: ${err?.message || err}`);
    }
  };

  const importEventsFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      try {
        (e.target as HTMLInputElement).value = ""; // consente re-import dello stesso file
      } catch {}
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const raw = stripBOM(String(reader.result || ""));
          const json = JSON.parse(raw);
          const list = Array.isArray(json)
            ? json
            : Array.isArray((json as any)?.events)
            ? (json as any).events
            : Array.isArray((json as any)?.data)
            ? (json as any).data
            : null;
          if (!Array.isArray(list)) {
            alert(`Formato JSON non valido: atteso array o {events:[...]} o {data:[...]}. `);
            return;
          }
          const normalize = (ev: any): Ev => {
            const idNum = Number(ev.id);
            return {
              id: Number.isFinite(idNum) ? Math.trunc(idNum) : Math.trunc(Date.now() + Math.random() * 1000),
              titolo: ev.titolo || "Senza titolo",
              data: toISODateSafe(ev.data) || (ev.data || ''),
              luogo: ev.luogo || "",
              descrizione: ev.descrizione || "",
              link: ev.link || "",
              poster: ev.poster || "",
              partecipanti: Number.isFinite(Number(ev.partecipanti)) ? Number(ev.partecipanti) : 0,
            };
          };
          const imported: Ev[] = (list as any[]).map(normalize);
          if (!window.confirm(`Sostituire completamente gli eventi con ${imported.length} elemento/i dal file?`)) return;
          persistLocal(imported);
          if (ONLINE) {
            try {
              await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'replace', events: imported }),
              });
            } catch {}
          }
          alert(`Import da file completato. Eventi totali ora: ${imported.length}.`);
        } catch (err: any) {
          alert(`JSON non valido: ${err?.message || err}`);
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      alert(`Errore di importazione: ${err?.message || err}`);
    }
  };

  // --- Email prestito ---
  const sendPrestitoEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const { nome, email, telefono, autore, titolo } = formData;
    if (!nome || !email || !telefono || !autore || !titolo) {
      setMessaggio("Compila tutti i campi obbligatori.");
      return;
    }
    const subject = encodeURIComponent(`Richiesta prestito - ${titolo}`);
    const body = encodeURIComponent(
      `Richiedente: ${nome}\\nEmail: ${email}\\nTelefono: ${telefono}\\nAutore (nome e cognome): ${autore}\\nTitolo: ${titolo}`
    );
    window.location.href = `mailto:pensionati.brancaleone@gmail.com?subject=${subject}&body=${body}`;
    setMessaggio("Richiesta inviata con successo!");
    setFormData({ nome: "", email: "", telefono: "", autore: "", titolo: "" });
  };

  // --- Login/Logout ---
  const doLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd === ADMIN_PASSWORD) {
      setAdmin(true);
      try {
        localStorage.setItem(ADMIN_KEY, "1");
      } catch {}
      setShowLogin(false);
      setPwd("");
    } else {
      alert(`Password errata`);
    }
  };
  const doLogout = () => {
    setAdmin(false);
    try {
      localStorage.removeItem(ADMIN_KEY);
    } catch {}
  };

  // =============================
  // UI
  // =============================
  return (
    <div className="min-h-screen bg-white text-blue-900">
      <header className="border-b border-blue-700 bg-blue-900 text-center py-6 text-white shadow-lg">
        {bannerSrc && (
          <div className="flex flex-col items-center mb-3">
            <img
              src={bannerSrc}
              alt="Cesare Pavese"
              className="h-40 w-40 rounded-full shadow-2xl border-4 border-white object-cover"
            />
            <p className="text-xs text-blue-100 mt-2 italic">Cesare Pavese</p>
          </div>
        )}
        <h1 className="text-3xl font-bold">Biblioteca Comunale "Cesare Pavese" – Brancaleone (RC)</h1>
        <p className="text-blue-100 mt-1">
          Corso Umberto I° – Orari: <strong>lun–sab 17:00–19:30</strong>
        </p>
        <p className="text-[11px] text-blue-200 mt-2">
          Sorgente dati: <strong>{ONLINE ? "Backend (Netlify)" : "Locale (browser)"}</strong>
          {ONLINE && (
            <span>
              {" "}· Stato: {netStatus === "online" ? "online" : netStatus === "error" ? "errore" : "offline"}
              {lastSync && ` · Ultima sincronizzazione: ${lastSync}`}
            </span>
          )}
        </p>
      </header>

      {/* Prestito libri */}
      <section className="bg-white border-b border-blue-200 py-10">
        <div className="mx-auto max-w-3xl px-4 text-blue-900">
          <h2 className="text-2xl font-semibold mb-4 text-blue-900">Richiesta di prestito libri</h2>
          <p className="mb-6 text-blue-800">
            Compila il modulo per richiedere il prestito. La richiesta verrà inviata via email alla biblioteca (
            <a href="mailto:pensionati.brancaleone@gmail.com" className="text-blue-700 underline">
              pensionati.brancaleone@gmail.com
            </a>
            ).
          </p>
          <form onSubmit={sendPrestitoEmail} className="space-y-4 bg-blue-50 p-6 rounded-2xl border border-blue-200">
            <input
              required
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              placeholder="Il tuo nome e cognome"
              className="w-full p-2 border border-blue-300 rounded"
            />
            <input
              required
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="La tua email"
              className="w-full p-2 border border-blue-300 rounded"
            />
            <input
              required
              type="tel"
              value={formData.telefono}
              onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
              placeholder="Numero di telefono"
              className="w-full p-2 border border-blue-300 rounded"
            />
            <input
              required
              value={formData.autore}
              onChange={(e) => setFormData({ ...formData, autore: e.target.value })}
              placeholder="Nome e cognome dell'autore"
              className="w-full p-2 border border-blue-300 rounded"
            />
            <input
              required
              value={formData.titolo}
              onChange={(e) => setFormData({ ...formData, titolo: e.target.value })}
              placeholder="Titolo del libro"
              className="w-full p-2 border border-blue-300 rounded"
            />
            {messaggio && <p className="text-green-700 font-semibold">{messaggio}</p>}
            <button type="submit" className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800">
              Invia richiesta
            </button>
          </form>
          <p className="mt-6 text-blue-800">
            Orari di apertura: <strong>dal lunedì al sabato dalle 17:00 alle 19:30</strong>
          </p>
        </div>
      </section>

      {/* Eventi culturali */}
      <section className="bg-blue-50 py-10">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="text-2xl font-semibold text-blue-900 mb-3">Eventi culturali</h2>
          <p className="text-sm text-blue-700 mb-4">
            Eventi totali: <strong>{eventsLocal.length}</strong>
          </p>

          {admin && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                type="button"
                onClick={prepareExport}
                className="px-3 py-2 rounded border border-blue-300 bg-white text-blue-900"
              >
                Prepara download eventi
              </button>
              <label className="px-3 py-2 rounded border border-blue-300 bg-white text-blue-900 cursor-pointer">
                Importa events.json (file)
                <input type="file" accept=".json,application/json" onChange={importEventsFromFile} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => {
                  setShowImportText(true);
                  setImportText(
                    '[\\n  {\\n    "titolo":"Prova – Lettura collettiva",\\n    "data":"2025-12-01T18:00",\\n    "luogo":"Sala conferenze",\\n    "descrizione":"Esempio di evento importato"\\n  }\\n]'
                  );
                }}
                className="px-3 py-2 rounded border border-blue-300 bg-white text-blue-900"
              >
                Importa da testo
              </button>
              <button
                type="button"
                onClick={() => {
                  const ev: Ev = {
                    id: Date.now(),
                    titolo: 'Evento di prova',
                    data: new Date().toISOString(),
                    luogo: 'Brancaleone',
                    descrizione: 'Inserito per test',
                    link: '',
                    poster: '',
                    partecipanti: 0,
                  };
                  persistLocal([...(eventsLocal || []), ev]);
                  alert(`Aggiunto evento di prova.`);
                }}
                className="px-3 py-2 rounded border border-blue-300 bg-white text-blue-900"
              >
                + Evento di prova
              </button>
              <button
                type="button"
                onClick={autoRepair}
                className="px-3 py-2 rounded bg-amber-500 text-white hover:bg-amber-600"
              >
                Ripara automaticamente
              </button>
            </div>
          )}

          {upcoming.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {upcoming.map((ev) => {
                const joined = joinedIds.includes(ev.id);
                return (
                  <div key={ev.id} className="bg-white shadow-md rounded-2xl p-6 border border-blue-200">
                    {ev.poster && (
                      <img src={ev.poster} alt="Locandina" className="w-full max-h-64 object-cover rounded mb-3" />
                    )}
                    <h4 className="text-xl font-semibold text-blue-800">{ev.titolo}</h4>
                    <p className="text-sm text-blue-700 mb-1">
                      <strong>Quando:</strong> {new Date(ev.data).toLocaleString("it-IT")}
                    </p>
                    <p className="text-sm text-blue-700 mb-2">📍 {ev.luogo}</p>
                    {ev.descrizione && <p className="text-blue-900 mb-2">{ev.descrizione}</p>}
                    {ev.link && (
                      <a className="text-blue-700 underline" href={ev.link} target="_blank" rel="noreferrer">
                        Approfondisci
                      </a>
                    )}
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className="text-sm text-blue-800">
                        👥 Partecipanti: <strong>{Number(ev.partecipanti || 0)}</strong>
                      </span>
                      <div className="flex gap-2">
                        {admin && (
                          <button
                            type="button"
                            onClick={() => askDelete(ev)}
                            className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                            title="Elimina evento"
                          >
                            Elimina
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleJoin(ev.id)}
                          className={`px-3 py-2 rounded text-white ${joined ? 'bg-gray-600 hover:bg-gray-700' : 'bg-green-600 hover:bg-green-700'}`}
                          title={joined ? 'Annulla partecipazione' : 'Partecipo'}
                        >
                          {joined ? 'Annulla' : 'Partecipo'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="italic text-blue-700">Nessun evento disponibile.</p>
          )}

          {admin && (
            <div className="mt-6 p-4 rounded-xl border border-blue-200 bg-white text-sm">
              <h3 className="font-semibold text-blue-800 mb-2">Gestione eventi (bozza manuale)</h3>
              <form onSubmit={addLocal} className="grid md:grid-cols-2 gap-3">
                <input
                  value={draft.titolo}
                  onChange={(e) => setDraft({ ...draft, titolo: e.target.value })}
                  placeholder="Titolo*"
                  className="w-full p-2 border border-blue-300 rounded"
                />
                <input
                  type="datetime-local"
                  value={draft.data}
                  onChange={(e) => setDraft({ ...draft, data: e.target.value })}
                  className="w-full p-2 border border-blue-300 rounded"
                />
                <input
                  value={draft.luogo}
                  onChange={(e) => setDraft({ ...draft, luogo: e.target.value })}
                  placeholder="Luogo*"
                  className="w-full p-2 border border-blue-300 rounded"
                />
                <input
                  value={draft.link}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                  placeholder="Link (facoltativo)"
                  className="w-full p-2 border border-blue-300 rounded"
                />
                <div>
                  <label className="block text-sm text-blue-800 mb-1">Locandina (URL immagine)</label>
                  <input
                    value={draft.poster || ""}
                    onChange={(e) => {
                      setDraft({ ...draft, poster: e.target.value });
                      setPosterPreview(e.target.value);
                    }}
                    placeholder="https://..."
                    className="w-full p-2 border border-blue-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-blue-800 mb-1">Oppure carica immagine</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onPosterFile}
                    className="w-full p-2 border border-blue-300 rounded bg-white"
                  />
                </div>
                <textarea
                  value={draft.descrizione || ""}
                  onChange={(e) => setDraft({ ...draft, descrizione: e.target.value })}
                  placeholder="Descrizione"
                  className="w-full p-2 border border-blue-300 rounded md:col-span-2"
                />
                {posterPreview && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-blue-800 mb-1">Anteprima locandina</p>
                    <img src={posterPreview} alt="Anteprima" className="max-h-64 rounded border border-blue-200" />
                    <div>
                      <button type="button" onClick={clearPoster} className="mt-2 px-2 py-1 text-xs bg-gray-200 rounded">
                        Rimuovi immagine
                      </button>
                    </div>
                  </div>
                )}
                <div className="md:col-span-2 flex justify-end gap-2">
                  <button type="submit" className="px-3 py-2 bg-blue-700 text-white rounded">
                    Aggiungi evento
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>

      <footer className="bg-blue-900 text-white text-center py-6">
        <p className="mb-2 text-sm text-blue-100">Stato Admin: {admin ? 'Connesso' : 'Non connesso'}</p>
        {!admin && (
          <button onClick={() => setShowLogin(true)} className="px-4 py-2 bg-blue-700 rounded text-white">
            Login Admin
          </button>
        )}
        {admin && (
          <button onClick={doLogout} className="px-4 py-2 bg-red-600 rounded text-white">
            Logout
          </button>
        )}
      </footer>

      {/* Modali */}
      {showJson && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowJson(false);
          }}
        >
          <div className="bg-white text-blue-900 w-[90vw] max-w-3xl p-4 rounded-2xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Anteprima events.json</h3>
              <button onClick={() => setShowJson(false)} className="px-3 py-1 bg-gray-200 rounded">
                Chiudi
              </button>
            </div>
            <textarea
              ref={jsonAreaRef}
              value={jsonText}
              readOnly
              className="w-full h-72 border border-blue-300 rounded p-2 font-mono text-sm"
            />
            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => {
                  if (jsonAreaRef.current) {
                    jsonAreaRef.current.focus();
                    jsonAreaRef.current.select();
                    document.execCommand('copy');
                  }
                }}
                className="px-3 py-2 bg-white border border-blue-300 rounded text-blue-900"
              >
                Seleziona tutto
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(jsonText);
                    alert(`Copiato negli appunti`);
                  } catch {
                    alert(`Copia non disponibile: usa "Seleziona tutto" e poi Ctrl/Cmd+C.`);
                  }
                }}
                className="px-3 py-2 bg-blue-700 text-white rounded"
              >
                Copia JSON
              </button>
              <a
                href={exportReadyUrl}
                download="events.json"
                className="px-3 py-2 bg-green-600 text-white rounded"
                target="_blank"
                rel="noopener"
              >
                Scarica
              </a>
            </div>
          </div>
        </div>
      )}

      {showImportText && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImportText(false);
          }}
        >
          <div className="bg-white text-blue-900 w-[90vw] max-w-3xl p-4 rounded-2xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Importa eventi da testo</h3>
              <button onClick={() => setShowImportText(false)} className="px-3 py-1 bg-gray-200 rounded">
                Chiudi
              </button>
            </div>
            <p className="text-sm text-blue-800 mb-2">
              Incolla qui un array di eventi JSON o un oggetto {'{ events: [...] }'}/{'{ data: [...] }'}. L'import sostituirà completamente quelli esistenti.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              onPaste={(e) => {
                try {
                  const t = e.clipboardData?.getData('text');
                  if (t) {
                    e.preventDefault();
                    setImportText((prev) => (prev ? prev + normalizeJsonText(t) : normalizeJsonText(t)));
                  }
                } catch {}
              }}
              className="w-full h-72 border border-blue-300 rounded p-2 font-mono text-sm"
              placeholder='Esempio: [{"titolo":"Evento","data":"2025-12-01T18:00","luogo":"Sala"}]'
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={importFromText} className="px-3 py-2 bg-blue-700 text-white rounded">
                Importa
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogin && (
        <div
          className="fixed inset-0 flex justify-center items-center bg-black bg-opacity-40 z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogin(false);
          }}
        >
          <div className="bg-white text-blue-900 p-6 rounded-2xl shadow-lg w-80">
            <h3 className="text-lg font-semibold mb-3">Accesso Amministratore</h3>
            <form onSubmit={doLogin}>
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Password"
                className="w-full mb-3 p-2 border border-blue-300 rounded"
              />
              <div className="flex justify-between">
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">
                  Accedi
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogin(false)}
                  className="px-4 py-2 bg-gray-300 text-blue-900 rounded"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDel.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelDelete();
          }}
        >
          <div className="bg-white text-blue-900 w-[92vw] max-w-md rounded-2xl shadow-xl p-5">
            <h3 className="text-lg font-semibold mb-2">Conferma eliminazione</h3>
            <p className="mb-4">
              Eliminare l'evento <strong>"{confirmDel.title}"</strong>? Questa azione non può essere annullata.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={cancelDelete} className="px-3 py-2 rounded bg-gray-200">
                Annulla
              </button>
              <button onClick={confirmDelete} className="px-3 py-2 rounded bg-red-600 text-white">
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
