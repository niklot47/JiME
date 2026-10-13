// Smoke test for cdp.mjs: Packs screen, then a new game with default settings
const click = (text) => ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes(${JSON.stringify(text)})); if (!b) return "no button ${text}"; b.click(); return "ok"; })()`);
console.log("origin", await ev("location.href"));
console.log(await click("Паки")); await sleep(1500);
console.log("packs:", await ev("document.querySelector('.form')?.innerText"));
await shot("packs");
console.log(await click("Меню")); await sleep(300);
console.log(await click("Игра")); await sleep(2500);
console.log(await click("Начать")); await sleep(5000);
console.log("panel:", (await ev("document.querySelector('.game-panel')?.innerText || document.body.innerText")).slice(0, 400));
await shot("game");
