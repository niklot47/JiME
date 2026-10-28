"""Texts of the demo pack: key -> {ru, en, it}. "[b]..[/b]" / "[i]..[/i]" are the game's markup, "\n" a line break."""

T = {}


def t(key, ru, en, it):
    T[key] = {"ru": ru, "en": en, "it": it}


# ------------------------------------------------------------------ interface texts the engine shows
t("UI_CONFIRM", "Подтвердить", "Confirm", "Conferma")
t("UI_CANCEL", "Отмена", "Cancel", "Annulla")
t("UI_PASS", "Успех", "Pass", "Successo")
t("UI_FAIL", "Неудача", "Fail", "Fallimento")
t("UI_SEARCH", "Обыскать", "Search", "Perquisisci")
t("UI_YES", "Да", "Yes", "Sì")
t("UI_NO", "Нет", "No", "No")
t("UI_CONTINUE", "Продолжить", "Continue", "Continua")
t("UI_CONFIRM_EXPLORE", "Исследовать?", "Explore?", "Esplorare?")
t("UI_PLACE_EXPLORE_TOKEN", "Положите жетон исследования.", "Place an exploration token.", "Piazzate un segnalino esplorazione.")
t("UI_PLACE_EXPLORE_TOKENS", "Положите жетоны исследования.", "Place exploration tokens.", "Piazzate i segnalini esplorazione.")
t("UI_DISCARD_EXPLORE_TOKEN", "Сбросьте жетон исследования.", "Discard the exploration token.", "Scartate il segnalino esplorazione.")
t("UI_DISCARD_EXPLORE_TOKEN_WITH_INSPIRATION", "Сбросьте жетон исследования и получите 1 вдохновение.",
  "Discard the exploration token and gain 1 inspiration.", "Scartate il segnalino esplorazione e ottenete 1 ispirazione.")
t("UI_EXPLORE_TILE_WITH_INTRO_FORMATTED", "{0}\n\n{1}", "{0}\n\n{1}", "{0}\n\n{1}")
t("UI_SECTION_REVEAL_PLACE_TILE_FORMATTED", "Положите тайл {0}, как показано.", "Place tile {0} as shown.", "Piazzate la tessera {0} come indicato.")
t("PLACE_TILE_NO_FLAVOR", "Положите тайл {0}, как показано.", "Place tile {0} as shown.", "Piazzate la tessera {0} come indicato.")
t("PLACE_SEARCH", "{0}\n\nПоложите жетон поиска, как показано.", "{0}\n\nPlace a search token as shown.", "{0}\n\nPiazzate un segnalino ricerca come indicato.")
t("PLACE_PERSON", "{0}\n\nПоложите жетон персонажа, как показано.", "{0}\n\nPlace a person token as shown.", "{0}\n\nPiazzate un segnalino personaggio come indicato.")
t("PLACE_THREAT", "{0}\n\nПоложите жетон угрозы, как показано.", "{0}\n\nPlace a threat token as shown.", "{0}\n\nPiazzate un segnalino minaccia come indicato.")
t("UI_SPAWN_GROUP_FORMAT", "Поставьте {0} {1} на указанное место.", "Place {0} {1} on the shown space.", "Piazzate {0} {1} nello spazio indicato.")
t("UI_THREAT_INCREASE", "[i]Тень сгущается.[/i]\n\nУгроза растёт на {0}.", "[i]The shadow grows.[/i]\n\nThreat increases by {0}.",
  "[i]L'ombra si allunga.[/i]\n\nLa minaccia aumenta di {0}.")
t("UI_PHASE_HERO", "Фаза действий", "Action phase", "Fase azione")
t("UI_PHASE_SHADOW", "Фаза тени", "Shadow phase", "Fase ombra")
t("UI_RALLY_PHASE", "Фаза сбора", "Rally phase", "Fase raccolta")
t("UI_RALLY_PHASE_INSTRUCTIONS", "Каждый герой собирает колоду заново, затем [b]разведывает 2[/b].",
  "Each hero rebuilds their deck, then [b]scouts 2[/b].", "Ogni eroe ricompone il mazzo, poi [b]esplora 2[/b].")
t("UI_PROMPT_CAN_ATTACK", "Может ли враг атаковать?", "Can the enemy attack?", "Il nemico può attaccare?")
t("UI_DAMAGE_LOG_FORMATTED", "{0} урона, {1} страха", "{0} damage, {1} fear", "{0} danni, {1} paura")
t("UI_DAMAGE_LOG_WITH_EFFECT_FORMATTED", "{0} урона, {1} страха\n\n{2}", "{0} damage, {1} fear\n\n{2}", "{0} danni, {1} paura\n\n{2}")
t("UI_ENEMY_DEFEATED_INSPIRATION_REMINDER", "\nВы или герой рядом получаете 1 вдохновение!", "\nYou or a nearby hero gain 1 inspiration!",
  "\nVoi o un eroe vicino ottenete 1 ispirazione!")
t("UI_ENEMY_REMOVAL_REMINDER_FORMATTED", "Уберите {0} {1}.{2}", "Remove {0} {1}.{2}", "Rimuovete {0} {1}.{2}")
t("UI_ENEMY_REMOVAL_UNIQUE_REMINDER_FORMATTED", "Уберите {0}.{1}", "Remove {0}.{1}", "Rimuovete {0}.{1}")
t("UI_LAST_STAND_FAILED", "Вы пали!\n\nУберите фигурку с карты. В начале следующей фазы тени приключение будет проиграно.",
  "You have fallen!\n\nRemove your figure from the map. At the start of the next shadow phase the adventure is lost.",
  "Siete caduti!\n\nRimuovete la miniatura dalla mappa. All'inizio della prossima fase ombra l'avventura è persa.")
t("UI_LAST_STAND_PASSED_FEAR", "Сбросьте все лицом вниз карты страха, получите 1 вдохновение и продолжайте.",
  "Discard all facedown fear, gain 1 inspiration and go on.", "Scartate tutta la paura coperta, ottenete 1 ispirazione e proseguite.")
t("UI_LAST_STAND_PASSED_PHYSICAL", "Сбросьте все лицом вниз карты урона, получите 1 вдохновение и продолжайте.",
  "Discard all facedown damage, gain 1 inspiration and go on.", "Scartate tutti i danni coperti, ottenete 1 ispirazione e proseguite.")
t("UI_AWARD_ITEM_FORMATTED", "Вы получаете: [b]{0}[/b]!\n\nВы или герой рядом можете сразу его взять.",
  "You gain [b]{0}[/b]!\n\nYou or a nearby hero may equip it at once.", "Ottenete [b]{0}[/b]!\n\nVoi o un eroe vicino potete equipaggiarlo subito.")
t("UI_AWARD_TITLE_FORMATTED", "Вы получаете звание [b]{0}[/b]!", "You gain the title [b]{0}[/b]!", "Ottenete il titolo [b]{0}[/b]!")
t("UI_AWARD_TITLE_CHOOSE_HERO", "Какой герой получает звание?", "Which hero gains the title?", "Quale eroe ottiene il titolo?")
t("TITLE_ALREADY_EARNED", "Это звание уже получено.", "This title is already earned.", "Questo titolo è già stato ottenuto.")
t("ADVENTURE_MODE_INSPIRATION_MESSAGE", "[i]Отряд готов встретить тень.[/i]\n\nКаждый герой получает 1 вдохновение.",
  "[i]The fellowship is ready to face the shadow.[/i]\n\nEach hero gains 1 inspiration.",
  "[i]La compagnia è pronta ad affrontare l'ombra.[/i]\n\nOgni eroe ottiene 1 ispirazione.")
t("UI_LORE_CHRONICLING", "Летопись: +2 знания", "Chronicling: +2 lore", "Cronaca: +2 sapere")
t("UI_LORE_COLLECTOR", "Собиратель: +1 знание", "Collector: +1 lore", "Collezionista: +1 sapere")
t("UI_REVEAL_TERRAIN_LOG_FORMATTED", "Откройте местность: {0}", "Reveal terrain: {0}", "Rivelate il terreno: {0}")
t("UI_TERRAIN_NODES_REVEAL_FORMATTED", "Положите местность: {0}", "Place terrain: {0}", "Piazzate il terreno: {0}")
t("BLANK_OBJECTIVE", " ", " ", " ")
t("UI_DEFAULT_OBJECTIVE", "Цели пока нет.", "No objective yet.", "Nessun obiettivo per ora.")
t("UI_ROUND_X", "Раунд {0}", "Round {0}", "Round {0}")
t("UI_THREAT_VALUE_FORMATTED", "{0}/{1}", "{0}/{1}", "{0}/{1}")
t("UI_CONFIRM_DAMAGE_FORMAT", "Нанести [b]{0}[/b] попаданий?", "Apply [b]{0}[/b] hits?", "Applicare [b]{0}[/b] colpi?")
t("UI_BONUS_FORMAT", "[b]{0}[/b] — {1}", "[b]{0}[/b] - {1}", "[b]{0}[/b] - {1}")
t("UI_LORE_GAIN", "[b]{0}{1} знания[/b]", "[b]{0}{1} lore[/b]", "[b]{0}{1} sapere[/b]")
t("UI_ATTACK", "Атака", "Attack", "Attacco")
t("UI_PROVOKE", "Провокация", "Provoke", "Provocazione")
t("UI_RESOLVE_ATTACK", "Провести атаку", "Resolve attack", "Risolvi attacco")
t("UI_FEAR", "Страх", "Fear", "Paura")
t("UI_PHYSICAL", "Урон", "Damage", "Danni")
t("UI_LORE", "Знание", "Lore", "Sapere")
t("UI_INVENTORY", "Снаряжение", "Inventory", "Inventario")

# ------------------------------------------------------------------ components
for code in [f"D{n:02d}{s}" for n in range(1, 11) for s in "AB"]:
    t(code, code, code, code)
TILE_FLAVOR = {
    "D01": ("Старая дорога спускается к броду; в траве шуршит ветер.", "An old road runs down to the ford; wind rustles in the grass.",
            "Una vecchia strada scende al guado; il vento fruscia nell'erba."),
    "D02": ("Река здесь мелеет, и вода журчит по камням.", "The river runs shallow here, murmuring over stones.",
            "Qui il fiume è basso e mormora sulle pietre."),
    "D03": ("Опушка леса: светлые поляны и тёмные стволы.", "The forest edge: bright glades and dark trunks.",
            "Il limitare del bosco: radure chiare e tronchi scuri."),
    "D04": ("Обломки стен, поросшие мхом.", "Broken walls overgrown with moss.", "Muri spezzati coperti di muschio."),
    "D05": ("Холмы, с которых видна вся долина.", "Hills that overlook the whole valley.", "Colline che dominano tutta la valle."),
    "D06": ("Мокрая низина; под ногами хлюпает.", "A wet hollow; the ground squelches.", "Una conca umida; il terreno fa ciac."),
    "D07": ("Узкая тропа петляет между кустами.", "A narrow path winds between bushes.", "Un sentiero stretto serpeggia tra i cespugli."),
    "D08": ("Густой ельник глушит звуки.", "A thick fir wood muffles every sound.", "Un fitto bosco di abeti smorza ogni suono."),
    "D09": ("Развалины старой сторожевой башни.", "The ruins of an old watchtower.", "Le rovine di un'antica torre di guardia."),
    "D10": ("Луг, на котором пасутся дикие козы.", "A meadow where wild goats graze.", "Un prato dove pascolano capre selvatiche."),
}
for n, (ru, en, it) in TILE_FLAVOR.items():
    for s in "AB":
        t(f"TILE_{n}{s}", ru, en, it)

t("HERO_AIRA_NAME", "Айра", "Aira", "Aira")
t("HERO_BORIN_NAME", "Борин", "Borin", "Borin")
t("HERO_MAEVE_NAME", "Мейв", "Maeve", "Maeve")
t("HERO_TOLLAN_NAME", "Толлан", "Tollan", "Tollan")
t("RACE_DEMO_HUMAN", "Человек", "Human", "Umano")
t("RACE_DEMO_DWARF", "Гном", "Dwarf", "Nano")
t("RACE_DEMO_HALFLING", "Полурослик", "Halfling", "Mezzuomo")
for key, ru, en, it in [
    ("ITEM_DEMO_BOW", "Лук", "Bow", "Arco"), ("ITEM_DEMO_HAMMER", "Молот", "Hammer", "Martello"),
    ("ITEM_DEMO_STAFF", "Посох", "Staff", "Bastone"), ("ITEM_DEMO_DAGGER", "Кинжал", "Dagger", "Pugnale"),
    ("ITEM_DEMO_LEATHER", "Кожаный доспех", "Leather armour", "Armatura di cuoio"), ("ITEM_DEMO_MAIL", "Кольчуга", "Mail shirt", "Cotta di maglia"),
    ("ITEM_DEMO_CLOAK", "Дорожный плащ", "Travel cloak", "Mantello da viaggio"), ("ITEM_DEMO_LONGBOW", "Длинный лук", "Longbow", "Arco lungo"),
    ("ITEM_DEMO_WARHAMMER", "Боевой молот", "War hammer", "Martello da guerra"), ("ITEM_DEMO_RUNESTAFF", "Рунный посох", "Rune staff", "Bastone runico"),
    ("ITEM_DEMO_FANG", "Волчий клык", "Wolf fang", "Zanna di lupo"), ("ITEM_DEMO_LANTERN", "Фонарь", "Lantern", "Lanterna"),
    ("ITEM_DEMO_FERRY_TOKEN", "Жетон паромщика", "Ferryman's token", "Gettone del traghettatore"),
]:
    t(key, ru, en, it)
SKILL_NAMES = [
    ("Меткий глаз", "Keen Eye", "Occhio acuto"), ("Тихий шаг", "Quiet Step", "Passo silenzioso"), ("Знание троп", "Pathfinding", "Conoscere i sentieri"),
    ("Крепкий удар", "Heavy Blow", "Colpo pesante"), ("Каменная стойкость", "Stone Endurance", "Tenacia di pietra"), ("Старые песни", "Old Songs", "Canti antichi"),
    ("Целебные травы", "Healing Herbs", "Erbe curative"), ("Тихое слово", "Calming Word", "Parola calma"), ("Ясный взгляд", "Clear Sight", "Sguardo limpido"),
    ("Ловкие руки", "Nimble Fingers", "Dita agili"), ("Удача", "Luck", "Fortuna"), ("Неприметность", "Unnoticed", "Inosservato"),
    ("Разведка", "Scouting", "Ricognizione"), ("Быстрые ноги", "Swift Feet", "Piedi veloci"), ("Засада", "Ambush", "Imboscata"),
    ("Следопыт", "Tracker", "Segugio"), ("Тень в листве", "Shadow in the Leaves", "Ombra tra le foglie"), ("Дальний выстрел", "Long Shot", "Tiro lungo"),
    ("Щит товарищу", "Shield a Friend", "Scudo all'amico"), ("Стена", "Wall", "Muro"), ("Вызов", "Challenge", "Sfida"),
    ("Несгибаемый", "Unbending", "Inflessibile"), ("Ответный удар", "Riposte", "Contrattacco"), ("Боевой клич", "War Cry", "Grido di battaglia"),
    ("Свет надежды", "Light of Hope", "Luce di speranza"), ("Память предков", "Memory of Elders", "Memoria degli avi"), ("Последний рубеж", "Last Line", "Ultima linea"),
    ("Зов дома", "Call of Home", "Richiamo di casa"),
]
for i, (ru, en, it) in enumerate(SKILL_NAMES):
    t(f"SKILL_DEMO_{i}", ru, en, it)
t("ROLE_DEMO_SCOUT", "Разведчик", "Scout", "Esploratore")
t("ROLE_DEMO_GUARDIAN", "Страж", "Guardian", "Guardiano")
t("TITLE_DEMO_FORD_WARDEN", "Хранитель брода", "Warden of the Ford", "Custode del guado")
t("TITLE_DEMO_SHADOWBANE", "Гроза теней", "Shadowbane", "Flagello delle ombre")
t("ENEMY_DEMO_BANDIT", "Разбойник", "Bandit", "Bandito")
t("ENEMY_DEMO_BANDIT_PLURAL", "Разбойники", "Bandits", "Banditi")
t("ENEMY_DEMO_WOLF", "Серый волк", "Grey wolf", "Lupo grigio")
t("ENEMY_DEMO_WOLF_PLURAL", "Серые волки", "Grey wolves", "Lupi grigi")
t("ENEMY_DEMO_SHADE", "Тень", "Shade", "Ombra")
t("ENEMY_DEMO_SHADE_PLURAL", "Тени", "Shades", "Ombre")
for i, e, ru, en, it in [
    (9001, "BANDIT", "Атакует ближайшего героя.", "Attacks the nearest hero.", "Attacca l'eroe più vicino."),
    (9002, "BANDIT", "Подходит на 2 и атакует героя с наименьшим числом карт урона.", "Moves 2 and attacks the hero with the least damage.",
     "Si muove di 2 e attacca l'eroe con meno danni."),
    (9003, "WOLF", "Подходит на 3 и атакует.", "Moves 3 and attacks.", "Si muove di 3 e attacca."),
    (9004, "WOLF", "Стая окружает: атакует героя, рядом с которым нет других.", "The pack circles: attacks a hero with no one beside them.",
     "Il branco accerchia: attacca un eroe senza compagni vicini."),
    (9005, "SHADE", "Холод сковывает: атакует всех героев в 1 месте от себя.", "A chill grips: attacks every hero within 1 space.",
     "Un gelo afferra: attacca ogni eroe entro 1 spazio."),
    (9006, "SHADE", "Подходит на 1 и атакует героя с наибольшим числом карт страха.", "Moves 1 and attacks the hero with the most fear.",
     "Si muove di 1 e attacca l'eroe con più paura."),
]:
    t(f"ENEMY_DEMO_{e}_ACTIVATION_{i}", ru, en, it)
    t(f"ENEMY_DEMO_{e}_ATTACK_{i}", "[i]Удар обрушивается на вас![/i]", "[i]The blow falls upon you![/i]", "[i]Il colpo si abbatte su di voi![/i]")
t("LAST_STAND_DEMO_D_1", "Раны тяжелы. Проверьте [b]Силу[/b] (2), чтобы устоять.", "The wounds are grave. Test [b]Might[/b] (2) to stand.",
  "Le ferite sono gravi. Prova di [b]Forza[/b] (2) per resistere.")
t("LAST_STAND_DEMO_D_2", "Вы падаете на колено. Проверьте [b]Ловкость[/b] (2).", "You fall to one knee. Test [b]Agility[/b] (2).",
  "Cadete in ginocchio. Prova di [b]Agilità[/b] (2).")
t("LAST_STAND_DEMO_F_1", "Тьма шепчет. Проверьте [b]Дух[/b] (2).", "The dark whispers. Test [b]Spirit[/b] (2).", "Il buio sussurra. Prova di [b]Spirito[/b] (2).")
t("LAST_STAND_DEMO_F_2", "Страх сжимает сердце. Проверьте [b]Мудрость[/b] (2).", "Fear grips your heart. Test [b]Wisdom[/b] (2).",
  "La paura stringe il cuore. Prova di [b]Saggezza[/b] (2).")

# ------------------------------------------------------------------ campaign
t("CAM_DEMO_TITLE", "Тени над Серым Бродом", "Shadows over Greyford", "Ombre su Guadogrigio")
t("CAM_DEMO_DESC", "Небольшая кампания JiME Reborn: два приключения у старого брода.",
  "A small JiME Reborn campaign: two adventures at the old ford.", "Una piccola campagna di JiME Reborn: due avventure al vecchio guado.")
t("CAM_DEMO_CONTENTS", "Демо-набор", "Demo set", "Set dimostrativo")
t("PROD_DEMO_TITLE", "Демо-набор", "Demo set", "Set dimostrativo")
t("PROD_DEMO_DESC", "Открытый набор для проверки приложения без оригинальной игры.", "An open set to try the app without the original game.",
  "Un set aperto per provare l'app senza il gioco originale.")
t("PROD_DEMO_CONTENTS", "20 тайлов, 4 героя, 3 врага", "20 tiles, 4 heroes, 3 enemies", "20 tessere, 4 eroi, 3 nemici")
t("CAM_DEMO_PROLOGUE", "[i]Серый Брод всегда был тихим местом: паром, трактир, да старая дорога на север. Но этой осенью паром стоит без дела, "
  "а путники пропадают один за другим. Говорят, у реки видели вооружённых людей — и что-то ещё, что не отбрасывает тени.[/i]",
  "[i]Greyford was always a quiet place: a ferry, an inn and the old road north. But this autumn the ferry stands idle and travellers vanish one by one. "
  "Armed men were seen by the river, they say - and something else, something that casts no shadow.[/i]",
  "[i]Guadogrigio è sempre stato un luogo tranquillo: un traghetto, una locanda e la vecchia strada verso nord. Ma quest'autunno il traghetto è fermo "
  "e i viandanti scompaiono uno dopo l'altro. Dicono di aver visto uomini armati lungo il fiume, e qualcos'altro, qualcosa che non proietta ombra.[/i]")
t("CAM_DEMO_VICTORY", "[i]Тень рассеялась, и над бродом снова слышен скрип парома. Люди долго будут помнить имена тех, кто вернул им дорогу.[/i]",
  "[i]The shade is gone, and the ferry creaks over the ford again. People will long remember the names of those who gave them back the road.[/i]",
  "[i]L'ombra è svanita e il traghetto torna a cigolare sul guado. La gente ricorderà a lungo i nomi di chi le ha restituito la strada.[/i]")
t("CAM_DEMO_DEFEAT", "[i]Туман над рекой стал гуще, и дорогу на север больше никто не ходит. Может быть, однажды придут другие.[/i]",
  "[i]The mist over the river grows thicker, and no one walks the north road any more. Perhaps others will come one day.[/i]",
  "[i]La nebbia sul fiume si fa più fitta e nessuno percorre più la strada del nord. Forse un giorno verranno altri.[/i]")

# the campaign map's labels
t("MAP_DEMO_GREYFORD", "Серый Брод", "Greyford", "Guadogrigio")
t("MAP_DEMO_RIVER", "Тихая река", "The Still River", "Il Fiume Quieto")
t("MAP_DEMO_HILLS", "Ветреные холмы", "The Windy Hills", "Le Colline Ventose")
# ------------------------------------------------------------------ adventure 1: the Grey Ford
t("D1_TITLE", "Серый Брод", "The Grey Ford", "Il Guado Grigio")
t("D1_LOCATION", "Берег реки", "The riverbank", "La riva del fiume")
t("D1_DESC", "Разбойники перекрыли брод. Найдите их лагерь.", "Bandits hold the ford. Find their camp.", "I banditi tengono il guado. Trovate il loro accampamento.")
t("D1_INTRO", "[i]Паромщик пропал три дня назад. Трактирщик просит вас разузнать, кто хозяйничает у брода.[/i]",
  "[i]The ferryman vanished three days ago. The innkeeper asks you to find out who rules the ford now.[/i]",
  "[i]Il traghettatore è scomparso tre giorni fa. L'oste vi chiede di scoprire chi comanda ora al guado.[/i]")
t("D1_HEROES", "Поставьте героев на указанное место.", "Place the heroes on the shown space.", "Piazzate gli eroi nello spazio indicato.")
t("D1_START_TILE", "[i]Дорога у брода пуста. На песке — свежие следы сапог.[/i]", "[i]The road by the ford is empty. Fresh boot prints mark the sand.[/i]",
  "[i]La strada presso il guado è vuota. Impronte fresche di stivali segnano la sabbia.[/i]")
t("D1_OBJECTIVE_1", "Найдите 3 улики, чтобы выследить разбойников.", "Find 3 clues to track the bandits down.", "Trovate 3 indizi per scovare i banditi.")
t("D1_OBJECTIVE_2", "Штурмуйте лагерь разбойников.", "Storm the bandits' camp.", "Assaltate l'accampamento dei banditi.")
t("D1_CLUE_MORE", "Ещё одна улика. Картина понемногу складывается.", "Another clue. The picture slowly comes together.",
  "Un altro indizio. Il quadro si compone a poco a poco.")
t("D1_CAMP_FOUND", "[i]Все следы ведут на холмы к востоку. Там, среди кустов, тлеют костры.[/i]",
  "[i]Every trail leads to the hills in the east. There, among the bushes, campfires smoulder.[/i]",
  "[i]Ogni traccia porta alle colline a est. Là, tra i cespugli, covano dei fuochi.[/i]")
t("D1_WIN", "[i]Лагерь пуст, разбойники бежали. Среди их добычи — карта с отметкой у старой башни и странный чёрный знак.[/i]",
  "[i]The camp is empty, the bandits fled. Among their loot is a map marking the old tower, and a strange black sign.[/i]",
  "[i]L'accampamento è vuoto, i banditi sono fuggiti. Tra il bottino c'è una mappa che segna la vecchia torre e uno strano segno nero.[/i]")
t("D1_LOSS", "[i]Вы отступаете к трактиру. Но у одного из разбойников вы отняли карту — с отметкой у старой башни.[/i]",
  "[i]You fall back to the inn. Yet you took a map from one of the bandits - with a mark at the old tower.[/i]",
  "[i]Ripiegate verso la locanda. Ma a uno dei banditi avete tolto una mappa, con un segno presso la vecchia torre.[/i]")
t("D1_THREAT_1", "[i]Из кустов выходят люди с дубинами.[/i]", "[i]Men with clubs step out of the bushes.[/i]", "[i]Uomini con randelli escono dai cespugli.[/i]")
t("D1_THREAT_2", "[i]Вдали воют волки — и вой приближается.[/i]", "[i]Wolves howl in the distance, and the howling comes closer.[/i]",
  "[i]In lontananza ululano i lupi, e l'ululato si avvicina.[/i]")
t("D1_THREAT_1_INFO", "Разбойники заметили вас.", "The bandits have spotted you.", "I banditi vi hanno notato.")
t("D1_THREAT_2_INFO", "Волки идут по следу.", "Wolves are on your trail.", "I lupi seguono le vostre tracce.")
t("D1_TRACKS_SEARCH", "У воды — примятая трава и следы множества ног.", "By the water the grass is trampled by many feet.",
  "Vicino all'acqua l'erba è calpestata da molti piedi.")
t("D1_TRACKS_TEST", "Проверьте [b]Мудрость[/b] (1), чтобы прочитать следы.", "Test [b]Wisdom[/b] (1) to read the tracks.",
  "Prova di [b]Saggezza[/b] (1) per leggere le tracce.")
t("D1_TRACKS_PASS", "Следы уходят на восток, к холмам. Это первая улика.", "The tracks lead east, to the hills. A first clue.",
  "Le tracce portano a est, verso le colline. Un primo indizio.")
t("D1_TRACKS_FAIL", "Следы путаются. Попробуйте позже.", "The tracks get muddled. Try again later.", "Le tracce si confondono. Riprovate più tardi.")
t("D1_FERRYMAN_INTRO", "На перевёрнутой лодке сидит старик и смотрит на реку.", "An old man sits on an upturned boat, watching the river.",
  "Un vecchio siede su una barca rovesciata e guarda il fiume.")
t("D1_FERRYMAN_CHOICE", "Это помощник паромщика. Он явно что-то знает.", "It is the ferryman's helper. He clearly knows something.",
  "È l'aiutante del traghettatore. Sa chiaramente qualcosa.")
t("D1_FERRYMAN_ASK", "Расспросить", "Question him", "Interrogarlo")
t("D1_FERRYMAN_PAY", "Заплатить (−1 знание)", "Pay him (-1 lore)", "Pagarlo (-1 sapere)")
t("D1_FERRYMAN_ASK_TEST", "Проверьте [b]Дух[/b] (2), чтобы он доверился вам.", "Test [b]Spirit[/b] (2) to win his trust.",
  "Prova di [b]Spirito[/b] (2) per ottenere la sua fiducia.")
t("D1_FERRYMAN_ASK_FAIL", "Старик отворачивается. Может быть, позже.", "The old man turns away. Maybe later.", "Il vecchio si volta. Forse più tardi.")
t("D1_FERRYMAN_PAY_RESULT", "Монета исчезает в его ладони. Уберите 1 знание.", "The coin vanishes into his palm. Lose 1 lore.",
  "La moneta sparisce nel suo palmo. Perdete 1 sapere.")
t("D1_FERRYMAN_CLUE", "«Паромщика увели на холмы. Их главарь носит чёрный знак». Это улика.",
  "\"They took the ferryman to the hills. Their leader wears a black sign.\" A clue.",
  "\"Hanno portato il traghettatore sulle colline. Il loro capo porta un segno nero.\" Un indizio.")
t("D1_CART_SEARCH", "У дороги лежит перевёрнутая повозка.", "An overturned cart lies by the road.", "Un carro rovesciato giace a lato della strada.")
t("D1_CART_TEST", "Проверьте [b]Ловкость[/b] (1), чтобы обыскать обломки.", "Test [b]Agility[/b] (1) to search the wreck.",
  "Prova di [b]Agilità[/b] (1) per frugare tra i resti.")
t("D1_CART_PASS", "Под досками — фонарь и обрывок письма о «лагере за холмами». Улика!",
  "Under the boards: a lantern and a scrap of a letter about \"the camp beyond the hills\". A clue!",
  "Sotto le assi: una lanterna e un pezzo di lettera sul \"campo oltre le colline\". Un indizio!")
t("D1_CART_FAIL", "Доски слишком тяжелы. Вернитесь позже.", "The boards are too heavy. Come back later.", "Le assi sono troppo pesanti. Tornate più tardi.")
t("D1_CAMP_INTRO", "Лагерь разбойников: шатры, костры, часовые.", "The bandits' camp: tents, fires, sentries.",
  "L'accampamento dei banditi: tende, fuochi, sentinelle.")
t("D1_CAMP_CONFIRM", "Штурмовать лагерь?", "Storm the camp?", "Assaltare l'accampamento?")
t("D1_CAMP_TEST", "Проверьте [b]Силу[/b] (2), чтобы прорваться в лагерь.", "Test [b]Might[/b] (2) to break into the camp.",
  "Prova di [b]Forza[/b] (2) per irrompere nell'accampamento.")
t("D1_CAMP_PASS", "[i]Часовые бегут, и лагерь ваш![/i]", "[i]The sentries flee, and the camp is yours![/i]", "[i]Le sentinelle fuggono e il campo è vostro![/i]")
t("D1_CAMP_FAIL", "[i]Тревога! Из шатров выбегают разбойники.[/i]", "[i]Alarm! Bandits pour out of the tents.[/i]",
  "[i]Allarme! I banditi escono dalle tende.[/i]")

# ------------------------------------------------------------------ adventure 2: the shade's lair
t("D2_TITLE", "Логово Тени", "The Shade's Lair", "La tana dell'Ombra")
t("D2_LOCATION", "Старая башня", "The old tower", "La vecchia torre")
t("D2_DESC", "Чёрный знак ведёт к развалинам башни.", "The black sign leads to the ruined tower.", "Il segno nero conduce alla torre in rovina.")
t("D2_INTRO", "[i]Башня стоит на холме уже сотни лет. Местные обходят её стороной: говорят, по ночам там горит холодный огонь.[/i]",
  "[i]The tower has stood on the hill for centuries. Locals avoid it: at night, they say, a cold fire burns there.[/i]",
  "[i]La torre sta sulla collina da secoli. La gente del posto la evita: dicono che di notte vi arda un fuoco freddo.[/i]")
t("D2_HEROES", "Поставьте героев на указанное место.", "Place the heroes on the shown space.", "Piazzate gli eroi nello spazio indicato.")
t("D2_START_TILE", "[i]У подножия башни холодно, хотя солнце ещё высоко.[/i]", "[i]It is cold at the foot of the tower, though the sun is still high.[/i]",
  "[i]Ai piedi della torre fa freddo, anche se il sole è ancora alto.[/i]")
t("D2_OBJECTIVE_1", "Найдите знаки, которые укажут путь к логову.", "Find the omens that show the way to the lair.",
  "Trovate i presagi che indicano la via per la tana.")
t("D2_OBJECTIVE_2", "Найдите алтарь и разрушьте его.", "Find the altar and destroy it.", "Trovate l'altare e distruggetelo.")
t("D2_OMEN_FIRST", "[i]Знак указывает на тропу за развалинами.[/i]", "[i]The omen points to a path beyond the ruins.[/i]",
  "[i]Il presagio indica un sentiero oltre le rovine.[/i]")
t("D2_OMEN_SECOND", "[i]Теперь вы знаете, где алтарь: в старом зале, под рухнувшей крышей.[/i]",
  "[i]Now you know where the altar is: in the old hall, under the fallen roof.[/i]",
  "[i]Ora sapete dov'è l'altare: nella vecchia sala, sotto il tetto crollato.[/i]")
t("D2_WIN", "[i]Алтарь раскалывается, и Тень тает, как дым на ветру.[/i]", "[i]The altar cracks, and the Shade melts like smoke in the wind.[/i]",
  "[i]L'altare si spacca e l'Ombra si dissolve come fumo nel vento.[/i]")
t("D2_LOSS", "[i]Холодный огонь вспыхивает ярче. Вы бежите с холма, и Тень остаётся в башне.[/i]",
  "[i]The cold fire flares up. You flee the hill, and the Shade remains in the tower.[/i]",
  "[i]Il fuoco freddo divampa. Fuggite dalla collina e l'Ombra resta nella torre.[/i]")
t("D2_THREAT_1", "[i]Среди камней шевелятся тени.[/i]", "[i]Shadows stir among the stones.[/i]", "[i]Ombre si muovono tra le pietre.[/i]")
t("D2_THREAT_2", "[i]Воздух звенит от холода. Что-то пришло за вами.[/i]", "[i]The air rings with cold. Something has come for you.[/i]",
  "[i]L'aria vibra di freddo. Qualcosa è venuto per voi.[/i]")
t("D2_THREAT_1_INFO", "Тени пробуждаются.", "The shades awaken.", "Le ombre si risvegliano.")
t("D2_THREAT_2_INFO", "Тень знает, что вы здесь.", "The Shade knows you are here.", "L'Ombra sa che siete qui.")
t("D2_OMEN1_SEARCH", "Камень с вырезанным вороном.", "A stone carved with a raven.", "Una pietra incisa con un corvo.")
t("D2_OMEN1_TEST", "Проверьте [b]Мудрость[/b] (1), чтобы понять знак.", "Test [b]Wisdom[/b] (1) to read the sign.",
  "Prova di [b]Saggezza[/b] (1) per leggere il segno.")
t("D2_OMEN1_PASS", "Ворон смотрит на север. Это первый знак.", "The raven looks north. The first omen.", "Il corvo guarda a nord. Il primo presagio.")
t("D2_OMEN1_FAIL", "Резьба стёрлась. Вернитесь позже.", "The carving is worn. Come back later.", "L'incisione è consumata. Tornate più tardi.")
t("D2_OMEN2_SEARCH", "Родник, вода в котором покрыта инеем.", "A spring whose water is covered in frost.", "Una sorgente la cui acqua è coperta di brina.")
t("D2_OMEN2_TEST", "Проверьте [b]Дух[/b] (1), чтобы коснуться воды.", "Test [b]Spirit[/b] (1) to touch the water.",
  "Prova di [b]Spirito[/b] (1) per toccare l'acqua.")
t("D2_OMEN2_PASS", "В отражении — зал с рухнувшей крышей. Второй знак!", "In the reflection: a hall with a fallen roof. The second omen!",
  "Nel riflesso: una sala dal tetto crollato. Il secondo presagio!")
t("D2_OMEN2_FAIL", "Холод обжигает пальцы. Вернитесь позже.", "The cold burns your fingers. Come back later.",
  "Il freddo vi brucia le dita. Tornate più tardi.")
t("D2_ALTAR_INTRO", "Чёрный алтарь, над которым дрожит холодное пламя.", "A black altar with a cold flame trembling above it.",
  "Un altare nero su cui trema una fiamma fredda.")
t("D2_ALTAR_CONFIRM", "Разрушить алтарь?", "Destroy the altar?", "Distruggere l'altare?")
t("D2_ALTAR_TEST", "Проверьте [b]Силу[/b] (3), чтобы расколоть камень.", "Test [b]Might[/b] (3) to split the stone.",
  "Prova di [b]Forza[/b] (3) per spaccare la pietra.")
t("D2_ALTAR_PASS", "[i]Камень трескается![/i]", "[i]The stone cracks![/i]", "[i]La pietra si incrina![/i]")
t("D2_ALTAR_FAIL", "[i]Пламя взвивается, и из тьмы выходят тени.[/i]", "[i]The flame leaps up, and shades step out of the dark.[/i]",
  "[i]La fiamma si alza e dalle tenebre escono delle ombre.[/i]")

# ------------------------------------------------------------------ the random events
for base, (ru_s, en_s, it_s), (ru_p, en_p, it_p) in [
    ("R_WELL", ("Заброшенный колодец.", "An abandoned well.", "Un pozzo abbandonato."),
     ("На дне блестит старая монета.", "An old coin glints at the bottom.", "Sul fondo brilla una vecchia moneta.")),
    ("R_TREE", ("Дуплистое дерево.", "A hollow tree.", "Un albero cavo."),
     ("В дупле — сверток с сушёными травами.", "In the hollow: a bundle of dried herbs.", "Nella cavità: un fagotto di erbe secche.")),
    ("R_CAMPFIRE", ("Брошенная стоянка.", "An abandoned campsite.", "Un bivacco abbandonato."),
     ("В золе — обрывок карты окрестностей.", "In the ashes: a scrap of a local map.", "Nella cenere: un frammento di mappa della zona.")),
    ("R_WAYSTONE", ("Придорожный камень с надписью.", "A waystone with an inscription.", "Una pietra miliare con un'iscrizione."),
     ("Надпись рассказывает о старом королевстве.", "The inscription tells of an old kingdom.", "L'iscrizione narra di un antico regno.")),
    ("R_BRAMBLE", ("Густые заросли ежевики.", "A dense bramble thicket.", "Un fitto roveto."),
     ("Среди колючек — оброненная кем-то фляга.", "Among the thorns: a flask someone dropped.", "Tra le spine: una borraccia caduta a qualcuno.")),
    ("G_PEDDLER", ("Брошенный короб торговца.", "A peddler's abandoned pack.", "Lo zaino abbandonato di un venditore ambulante."),
     ("Внутри — нитки, иглы и записка с местными слухами.", "Inside: thread, needles and a note of local rumours.",
      "Dentro: filo, aghi e un biglietto con le voci del posto.")),
    ("G_HUT", ("Пустая хижина пастуха.", "An empty shepherd's hut.", "Una capanna di pastore vuota."),
     ("На стене углём нарисована дорога к броду.", "A road to the ford is drawn in charcoal on the wall.",
      "Sul muro è disegnata col carbone una strada verso il guado.")),
    ("G_SHRINE", ("Рухнувшее придорожное святилище.", "A fallen roadside shrine.", "Un tempietto di strada crollato."),
     ("Под камнями — подношения давно ушедших путников.", "Under the stones: offerings of long-gone travellers.",
      "Sotto le pietre: offerte di viandanti di un tempo.")),
]:
    t(f"{base}_SEARCH", ru_s, en_s, it_s)
    t(f"{base}_TEST", "Проверьте [b]Ловкость[/b] (1).", "Test [b]Agility[/b] (1).", "Prova di [b]Agilità[/b] (1).")
    t(f"{base}_PASS", ru_p, en_p, it_p)
    t(f"{base}_FAIL", "Ничего не найдено. Можно попробовать снова.", "Nothing found. You may try again.", "Non trovate nulla. Potete riprovare.")

TEXTS = T
