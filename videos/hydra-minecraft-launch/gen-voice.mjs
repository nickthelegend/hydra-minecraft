// Serial TTS generator — works around the shared engine firing all kokoro
// calls via Promise.all (local model can't load concurrently). Generates each
// line one at a time, transcribes for word timings, and writes both the
// neutral engine meta and the product-launch meta.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const HF = ".";
const VOICE = "am_michael";
const script = readFileSync("SCRIPT.md", "utf8");

// parse "## Line N — ... (Frame M)" then the first indented (4-space) block
const lines = [];
const re = /##\s*Line\s*(\d+)[^\n]*\(Frame\s*(\d+)\)([\s\S]*?)(?=\n##\s|\n*$)/g;
let m;
while ((m = re.exec(script))) {
  const frame = Number(m[2]);
  const body = m[3];
  const spoken = body
    .split("\n")
    .filter((l) => /^\s{4}\S/.test(l))
    .map((l) => l.trim())
    .join(" ")
    .trim();
  if (spoken) lines.push({ frame, id: String(frame).padStart(2, "0"), text: spoken });
}
console.error(`parsed ${lines.length} lines`);

mkdirSync(join(HF, "assets/voice"), { recursive: true });

const ffprobe = (p) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", p,
    ]).toString().trim()
  );

const voices = [];
for (const ln of lines) {
  const rel = `assets/voice/${ln.id}.wav`;
  const abs = join(HF, rel);
  console.error(`· line ${ln.id} (frame ${ln.frame}): "${ln.text.slice(0, 48)}…"`);
  if (!existsSync(abs) || process.env.REDO_TTS) {
    execFileSync("npx", ["hyperframes", "tts", ln.text, "--voice", VOICE, "-o", abs], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  const dur = ffprobe(abs);

  // word timings via transcribe — words land in assets/voice/transcript.json
  let words = [];
  try {
    execFileSync(
      "npx",
      ["hyperframes", "transcribe", abs, "--json", "--language", "en"],
      { maxBuffer: 1 << 24, stdio: ["ignore", "ignore", "ignore"] }
    );
    const tj = JSON.parse(readFileSync(join(HF, "assets/voice/transcript.json"), "utf8"));
    const raw = Array.isArray(tj) ? tj : (tj.words || (tj.segments || []).flatMap((s) => s.words || []));
    words = raw.map((w, i) => ({
      id: i,
      text: (w.text ?? w.word ?? "").trim(),
      start: r3(w.start),
      end: r3(w.end),
    })).filter((w) => w.text);
  } catch (e) {
    console.error(`  transcribe failed (${e.message.slice(0, 60)}); even split`);
  }
  // fallback: distribute words evenly across the clip
  if (!words.length) {
    const toks = ln.text.split(/\s+/);
    const per = dur / toks.length;
    words = toks.map((t, i) => ({
      id: i, text: t, start: r3(i * per), end: r3((i + 1) * per),
    }));
  }
  voices.push({ id: ln.id, path: rel, duration_s: r3(dur), words });
  console.error(`  ✓ ${dur.toFixed(2)}s · ${words.length} words`);
}

function r3(n) { return Math.round(n * 1000) / 1000; }

// preserve BGM from whatever the engine already wrote
const neutralPath = join(HF, "audio_engine_meta.json");
const prev = existsSync(neutralPath) ? JSON.parse(readFileSync(neutralPath, "utf8")) : {};
const neutral = { ...prev, voices, sfx: prev.sfx ?? [] };
writeFileSync(neutralPath, JSON.stringify(neutral, null, 2));

const plPath = join(HF, "audio_meta.json");
const plPrev = existsSync(plPath) ? JSON.parse(readFileSync(plPath, "utf8")) : {};
const pl = {
  bgm: plPrev.bgm ?? null,
  voices: voices.map((v) => ({ frame: Number(v.id), path: v.path, duration_s: v.duration_s, words: v.words })),
  sfx: plPrev.sfx ?? [],
};
writeFileSync(plPath, JSON.stringify(pl, null, 2));

const total = voices.reduce((a, v) => a + v.duration_s, 0);
console.error(`\n✓ ${voices.length} voice lines · ${total.toFixed(1)}s total voice`);
