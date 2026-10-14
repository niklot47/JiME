// Text-mode play: the first human client of Session.
// Usage: node cli/play.ts <adv> [seed] [--lang ru|en|it] [--players N] [--load save.json]
// During play: number = choose, "u" = undo, "s [file]" = save, "l" = full log, "q" = quit.
import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLangCsv, TextDb } from "@jime/content-tools";
import { Session, type Answer, type Decision, type SaveData } from "../src/session.ts";
import { PackDirSource, defaultPackDir } from "../src/node/packSource.ts";

const args = process.argv.slice(2);
const opt = (name: string, d?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const lang = opt("--lang", "ru")!;
const players = Number(opt("--players", "2"));
const loadFile = opt("--load");
const [advArg = "1", seedArg = String(Date.now() % 100000)] = args;

const packDir = defaultPackDir();
const src = new PackDirSource(packDir);
const text = new TextDb(parseLangCsv(readFileSync(join(packDir, "lang", `${lang}.csv`), "utf8")));
const tty = process.stdout.isTTY;
const markup = (tag: "i" | "b", open: boolean) => (!tty ? "" : tag === "i" ? (open ? "\x1b[3m" : "\x1b[23m") : open ? "\x1b[1m" : "\x1b[22m");
const say = (key: string | null, ins: readonly string[] = []) => (key ? text.format(key, ins, { markup }) : "");
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s);

const session = loadFile
  ? Session.load(src, JSON.parse(readFileSync(loadFile, "utf8")) as SaveData)
  : new Session(src, { adv: Number(advArg), seed: Number(seedArg), players });

const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const r = await lines.next();
  if (!tty && !r.done) process.stdout.write(r.value + "\n"); // echo piped input
  return r.done ? "q" : r.value;
}
let shown = 0;
let lastRound = 0;

function printNewLog(): void {
  const log = session.log;
  if (shown > log.length) shown = 0; // after undo the log can be shorter
  for (; shown < log.length; shown++) {
    const [, round, key, ins] = log[shown]!;
    if (round !== lastRound) { console.log(dim(`\n——— ${say("UI_ROUND") || "Раунд"} ${round} ———`)); lastRound = round; }
    console.log("\n" + say(key, ins));
  }
}

function describe(d: Decision): { prompt: string; parse: (s: string) => Answer | undefined } {
  // the dialog text itself is already in the log; show it again only if it was not logged (e.g. confirm)
  if ("inserts" in d && d.key && session.log.at(-1)?.[2] !== d.key) console.log("\n" + say(d.key, d.inserts));
  const int = (s: string) => (/^\d+$/.test(s) ? Number(s) : undefined);
  const yn = (s: string) => (/^(y|д|да|yes|1)$/i.test(s) ? true : /^(n|н|нет|no|0)$/i.test(s) ? false : undefined);
  switch (d.kind) {
    case "choice": {
      d.choices.forEach((c, i) => console.log(`  ${i + 1}) ${say(c.key, c.inserts)}`));
      if (d.canCancel) console.log(`  0) ${say("UI_CANCEL") || "Отмена"}`);
      return { prompt: "Выбор: ", parse: (s) => (s === "0" && d.canCancel ? null : int(s) !== undefined ? int(s)! - 1 : undefined) };
    }
    case "test":
      return { prompt: `Сколько успехов? (важно до ${d.top}): `, parse: int };
    case "confirm":
      return { prompt: "Подтвердить? (д/н): ", parse: yn };
    case "lastStand":
      if (d.key) console.log("\n" + say(d.key, d.inserts));
      return { prompt: `Последний рубеж героя ${d.hero + 1} пройден? (д/н): `, parse: yn };
    case "lastStandType":
      return { prompt: `Последний рубеж героя ${d.hero + 1}: 1 — урон, 2 — страх: `, parse: (s) => (s === "1" ? true : s === "2" ? false : undefined) };
    case "hero":
      return {
        prompt: `Какой герой (1-${d.players}${d.canSkip ? ", 0 = пропустить" : ""})? `,
        parse: (s) => (s === "0" && d.canSkip ? { player: 0, skip: true } : int(s) ? { player: int(s)! - 1, skip: false } : undefined),
      };
    case "attack":
      return { prompt: `Урон по «${say(d.enemy)}» (${d.size} шт., ${d.damage}/${d.unitHp}): `, parse: int };
    case "action": {
      const v = session.view();
      console.log(dim(`\n${d.hero >= 0 ? `Герой ${d.hero + 1}` : "Фаза героев"} · угроза ${v.threat}/${v.threatMax} · врагов ${v.enemies.length}`));
      d.options.forEach((o, i) => {
        const label = o.type === "node" ? `Жетон: ${o.name.replace(/^\d+_/, "")}${o.tile ? ` (тайл ${o.tile})` : ""}`
          : o.type === "explore" ? `Исследовать тайл ${o.tile}`
          : o.type === "lastStand" ? `Последний рубеж: герой ${o.hero + 1}`
          : o.type === "provoke" ? `Провокация: группа #${o.uid}`
          : `Атаковать: ${say(o.enemy)} ×${o.size} (урон ${o.damage}/${o.unitHp})`;
        console.log(`  ${i + 1}) ${label}`);
      });
      console.log(d.hero >= 0 ? "  0) Закончить ход героя" : "  0) Завершить раунд");
      return { prompt: "Действие: ", parse: (s) => (s === "0" ? null : int(s) !== undefined ? int(s)! - 1 : undefined) };
    }
  }
}

console.log(dim(`Приключение ${session.setup.adv}, сид ${session.setup.seed}. Команды: u — отменить, s [файл] — сохранить, l — весь лог, q — выход.`));
for (;;) {
  printNewLog();
  if (session.status === "ended") {
    const v = session.view();
    console.log(dim(`\nИгра окончена: ${v.result ?? v.ended}, раунд ${v.round}, лор ${v.campaign.lore}, опыт ${v.campaign.xp}`));
    break;
  }
  const d = session.pending!;
  const { prompt, parse } = describe(d);
  const line = (await ask(prompt)).trim();
  if (line === "q") break;
  if (line === "u") { session.undo(); shown = 0; lastRound = 0; console.log(dim("(отменено, лог заново)")); continue; }
  if (line === "l") { shown = 0; lastRound = 0; continue; }
  if (line.startsWith("s")) {
    const file = line.slice(1).trim() || `jime-save-${session.setup.adv}-${session.setup.seed}.json`;
    writeFileSync(file, JSON.stringify(session.save(), null, 1));
    console.log(dim(`сохранено: ${file}`));
    continue;
  }
  const a = parse(line);
  if (a === undefined) { console.log("?"); continue; }
  try {
    session.answer(a);
  } catch (e) {
    console.log(`Не подходит: ${(e as Error).message}`);
  }
}
rl.close();
