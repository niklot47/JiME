// This app's own interface texts (the menus that work without the imported game). Packs' texts (campaigns, heroes,
// adventures) still come from their CSVs; these are only the labels of our screens. Missing language -> English.
import { useLang } from "../data/lang.ts";

const DICT: Record<string, { ru: string; en: string; it: string }> = {
  newCampaign: { ru: "Новая кампания", en: "New campaign", it: "Nuova campagna" },
  continue: { ru: "Продолжить", en: "Continue", it: "Continua" },
  load: { ru: "Загрузить", en: "Load", it: "Carica" },
  settings: { ru: "Настройки", en: "Settings", it: "Impostazioni" },
  tools: { ru: "Инструменты", en: "Tools", it: "Strumenti" },
  quit: { ru: "Выход", en: "Quit", it: "Esci" },
  back: { ru: "Назад", en: "Back", it: "Indietro" },
  next: { ru: "Далее", en: "Next", it: "Avanti" },
  start: { ru: "Начать", en: "Start", it: "Inizia" },
  chooseCampaign: { ru: "Выберите кампанию", en: "Choose a campaign", it: "Scegliete una campagna" },
  difficulty: { ru: "Сложность", en: "Difficulty", it: "Difficoltà" },
  toDifficulty: { ru: "Выберите уровень сложности", en: "Choose the difficulty", it: "Scegliete la difficoltà" },
  easy: { ru: "Приключение", en: "Adventure", it: "Avventura" },
  easyDesc: { ru: "Для тех, кому важнее история, чем бои.", en: "For those who care more about the story than fights.", it: "Per chi tiene più alla storia che ai combattimenti." },
  normal: { ru: "Обычная", en: "Normal", it: "Normale" },
  normalDesc: { ru: "Для знакомства с игрой и спокойных вечеров.", en: "To learn the game and for calm evenings.", it: "Per imparare il gioco e per serate tranquille." },
  hard: { ru: "Сложная", en: "Hard", it: "Difficile" },
  hardDesc: { ru: "Враги сильнее, угроза растёт быстрее.", en: "Enemies are stronger, threat rises faster.", it: "Nemici più forti, la minaccia sale più in fretta." },
  heroes: { ru: "Герои", en: "Heroes", it: "Eroi" },
  heroesHint: { ru: "Выберите от 1 до 5 героев.", en: "Pick 1 to 5 heroes.", it: "Scegliete da 1 a 5 eroi." },
  partyName: { ru: "Название отряда", en: "Fellowship name", it: "Nome della compagnia" },
  partyNameHint: { ru: "Как назовётся ваш отряд?", en: "What is your fellowship called?", it: "Come si chiama la vostra compagnia?" },
  savedGames: { ru: "Сохранённые кампании", en: "Saved campaigns", it: "Campagne salvate" },
  noSaves: { ru: "Сохранений пока нет.", en: "No saves yet.", it: "Ancora nessun salvataggio." },
  delete: { ru: "Удалить", en: "Delete", it: "Elimina" },
  deleteConfirm: { ru: "Удалить сохранение?", en: "Delete this save?", it: "Eliminare il salvataggio?" },
  resume: { ru: "Играть", en: "Play", it: "Gioca" },
  chapter: { ru: "Глава", en: "Chapter", it: "Capitolo" },
  language: { ru: "Язык", en: "Language", it: "Lingua" },
  look: { ru: "Оформление", en: "Look", it: "Aspetto" },
  lookOwn: { ru: "Своё", en: "Own", it: "Proprio" },
  lookOriginal: { ru: "Оригинал", en: "Original", it: "Originale" },
  lookOriginalMissing: { ru: "Оформление оригинала появится после импорта игры.", en: "The original look needs the imported game.", it: "L'aspetto originale richiede il gioco importato." },
  close: { ru: "Закрыть", en: "Close", it: "Chiudi" },
  map: { ru: "Карта", en: "Map", it: "Mappa" },
  nextAdventure: { ru: "Следующее приключение", en: "Next adventure", it: "Prossima avventura" },
  choose: { ru: "Выбрать", en: "Choose", it: "Scegli" },
  rest: { ru: "Привал", en: "Rest", it: "Riposo" },
  embark: { ru: "В путь", en: "Embark", it: "In marcia" },
  toMenu: { ru: "В меню", en: "To the menu", it: "Al menu" },
  lore: { ru: "Знание", en: "Lore", it: "Sapere" },
  role: { ru: "Роль", en: "Role", it: "Ruolo" },
  noRole: { ru: "— выберите роль —", en: "- choose a role -", it: "- scegliete un ruolo -" },
  xp: { ru: "опыт", en: "XP", it: "PE" },
  skills: { ru: "Навыки", en: "Skills", it: "Abilità" },
  items: { ru: "Снаряжение", en: "Gear", it: "Equipaggiamento" },
  partyItems: { ru: "Общие вещи", en: "Party items", it: "Oggetti della compagnia" },
  upgrade: { ru: "Улучшить", en: "Upgrade", it: "Migliora" },
  upgradeTo: { ru: "Улучшить до", en: "Upgrade to", it: "Migliora in" },
  rolesNeeded: { ru: "У каждого героя должна быть роль.", en: "Every hero needs a role.", it: "Ogni eroe deve avere un ruolo." },
  titleAwarded: { ru: "Получено звание", en: "Title earned", it: "Titolo ottenuto" },
  victory: { ru: "Победа", en: "Victory", it: "Vittoria" },
  defeat: { ru: "Поражение", en: "Defeat", it: "Sconfitta" },
  loading: { ru: "Загрузка…", en: "Loading…", it: "Caricamento…" },
  noCampaigns: { ru: "В паках нет кампаний.", en: "The packs have no campaigns.", it: "I pacchetti non hanno campagne." },
  level: { ru: "ур.", en: "lvl", it: "liv." },
};

export type TrKey = keyof typeof DICT;
export const tr = (lang: string, k: TrKey): string => {
  const e = DICT[k] as Record<string, string> | undefined;
  return e?.[lang] ?? e?.en ?? String(k);
};
/** t("key") in the current language */
export function useTr(): (k: TrKey) => string {
  const lang = useLang();
  return (k) => tr(lang, k);
}
