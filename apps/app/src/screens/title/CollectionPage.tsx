// The collection (CollectionManager, ProductView, CollectionItem): the products in a row at the bottom, green when
// owned and red when not; the picked one in detail above with its contents and the Enable / Disable button. What is
// owned limits the campaigns, heroes and items of a new game (UserCollectionManager).
import { useMemo, useState } from "react";
import { NguiView, type Binds } from "../../ngui/NguiView.tsx";
import { findNode, type UiNode } from "../../ngui/types.ts";
import { SLIDE, withEnter, type TitleUi } from "./common.ts";

const GREEN = [0, 0.75, 0, 1];
const RED = [0.75, 0, 0, 1];
const WHITE = [1, 1, 1, 1];
const GRAY = [0.5, 0.5, 0.5, 1];
const SLOTS = 6;
const LINES = 10;

/** ProductModel.ExpansionType (CoreSet, BoxExpansion, FigurePack, DLC) -> the glow around its box */
const glow = (type: number) => (type === 2 ? "small_box_glow" : type === 1 ? "expansion_box_glow" : "box_glow");

export function CollectionPage({ ui, onToggle, onBack, onOptions }: {
  ui: TitleUi;
  /** the new owned list (product ids) */
  onToggle: (owned: number[]) => void;
  onBack: () => void;
  onOptions: () => void;
}) {
  const P = ui.db.models.ProductModel ?? {};
  // UserCollectionManager.GetProducts(ownedOnly: false, includeDLCs: false)
  const ids = useMemo(() => Object.keys(P).map(Number).filter((id) => !P[String(id)].IsDLC).sort((a, b) => a - b), [P]);
  const [sel, setSel] = useState(ids[0] ?? 0);
  const show = useMemo(() => [findNode(ui.layout.root, "CollectionManager")].filter(Boolean) as UiNode[], [ui.layout]);
  const owned = (id: number) => id === 0 || !ui.products || ui.products.includes(id);

  const m = P[String(sel)] ?? {};
  // ProductView.SetProductEnabled: the core set and locked products can't be switched off
  const canToggle = sel > 0 && !m.IsLocked;
  const toggle = () => {
    const now = ui.products ?? ids;
    onToggle(now.includes(sel) ? now.filter((x) => x !== sel) : [...now, sel].sort((a, b) => a - b));
  };
  // the texts keep "\n" escapes as written in the tables
  const lines = ui.raw(m.ContentsKey).replace(/\\n/g, "\n").replace(/\n\n/g, "\n").split("\n");

  const b: Binds = {
    CollectionManager: { show: true },
    "CollectionManager/Sprite_Options": { onClick: onOptions },
    "CollectionManager/Button_Back": { onClick: onBack },
    "DetailedProductView//Sprite_Image": { tex: ui.productArt[String(sel)]?.Image },
    "Sprite_Image/Sprite_Highlight": { sprite: glow(Number(m.Type ?? 0)), color: m.IsLocked ? WHITE : owned(sel) ? GREEN : RED },
    Label_Title: { html: ui.say(m.NameKey) },
    Label_Description: { html: ui.say(m.DescriptionKey) },
    // no webstore button: the Enable button moves under the box
    Button_Webstore: { show: false },
    Button_Add: { onClick: canToggle ? toggle : undefined, disabled: !canToggle, at: [-203.8, -150] },
    Label_Add: {
      html: ui.say(owned(sel) ? "UI_COLLECTION_DISABLE" : "UI_COLLECTION_ENABLE"),
      color: !canToggle ? GRAY : owned(sel) ? RED : GREEN,
    },
  };
  for (let i = 0; i < LINES; i++) b[i ? `Label_Content (${i})` : "Grid_Content/Label_Content"] = { text: lines[i] ?? "" };
  for (let i = 0; i < SLOTS; i++) {
    const name = i ? `CollectionItem (${i})` : "Table_Products/CollectionItem";
    const id = ids[i];
    if (id === undefined) { b[name] = { show: false }; continue; }
    const p = P[String(id)];
    b[name] = { onClick: () => setSel(id), className: id === sel ? "ng-picked" : undefined };
    const at = i ? name : "CollectionItem";
    b[`${at}/Sprite_ItemImage`] = { tex: ui.productArt[String(id)]?.Image };
    b[`${at}/Sprite_Highlight`] = { sprite: glow(Number(p.Type ?? 0)), color: p.IsLocked ? WHITE : owned(id) ? GREEN : RED };
  }
  // CollectionManager.CoroutineShow: the panel fades in, back and title slide in, then the product's details
  // (ProductView FadeIn); the boxes fade in (CollectionItem.CoroutineFadeInItem)
  const anim = withEnter(b, show[0] ?? null, {
    CollectionManager: SLIDE.fade(0.35),
    "DetailedProductView/Widget_Content": SLIDE.fade(0.35, 0.7),
    Table_Products: SLIDE.fade(0.35, 0.35),
  });
  return <NguiView layout={ui.layout} atlas={ui.atlas} show={show} binds={anim} say={ui.say} className="ngui-page" />;
}
