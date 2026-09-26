# 原创 RPG 界面素材

2026-09-26，使用内置 imagegen 生成。三张图片均为原创游戏 UI 素材；用户提供的画面只作为风格方向，未作为编辑目标。原图已复制进扩展，运行时无需联网下载素材。

- 角色头像：`assets/ranger-portrait-v1.png`
- 雕花面板：`assets/ornate-panel-v1.png`
- 头像由 CSS 圆形裁切显示；面板通过 CSS border-image 九宫格伸展。原始位图未进行二次修改。

## 0.6 宝箱素材

使用内置 imagegen（非 CLI）新生成一张原创透明宝箱插画，原图保存在 `assets/treasure-chest-v1.png`，未进行二次修改；收藏品小图标由 `relic-icons.js` 采用与既有 HUD 相同的 SVG 工艺绘制。

完整生成提示词：

Use case: stylized-concept. Asset type: one isolated painted treasure chest icon for a sophisticated dark fantasy RPG browser HUD. A small closed ancient oak coffer in a clear three-quarter front view, intricate tarnished antique-gold and bronze metal bands with delicate leaf engraving, central blue-green gemstone lock, slightly worn dark leather and walnut wood, faint warm golden light escaping a hairline seam beneath the lid. Elegant, realistic hand-painted game inventory artwork, high detail materials, grounded proportions, subtle brushwork, comparable to classic cinematic fantasy RPG equipment art, NOT pixel art, not cartoon, not a vector. Center the single complete chest, taking 72% of the image with generous even margins; fully transparent background including no floor, no pedestal, no surrounding scenery, no text, no lettering, no UI frame, no watermark. Soft warm light from upper left, subtle teal rim, clean readable silhouette at 48 pixels. Square composition.

## 头像完整生成提示词

Use case: stylized-concept. Asset type: production fantasy RPG character portrait for a tiny browser game HUD. Create ONE square 1024x1024 painterly, realistic medieval dark fantasy portrait. Original adult female elven ranger with pale warm skin, calm determined face, platinum-blonde hair swept to one side, deep forest green cloak, finely detailed antique bronze armor collar. Close head and shoulders, face centered and quite large, head fully within middle 70 percent, lit by a soft warm golden key light and cool forest rim light. Classic hand-painted premium PC RPG inventory portrait, rich brushwork and natural facial proportions, reminiscent of the material richness of Baldur's Gate 3 and Diablo IV, absolutely NOT anime, not cartoon, not pixel art, not vector or flat graphic. Very dark blurred woodland background. No frame, no circle mask, no text, no symbols, no UI, no logo, no watermark. This will be cropped into a small circle by CSS, so keep the face immediately recognizable at 56 pixels.

## 面板完整生成提示词

Use case: stylized-concept. Asset type: single empty ornamental fantasy RPG UI panel background, to be used behind live HTML text and bars. Generate ONE flat front-facing vertical rectangular panel 1024x1792 pixels, no perspective. Original premium dark medieval fantasy RPG interface art, the intricate aged metal and weathered leather materials of a classic PC role playing game, a balance of Baldur's Gate 3 antique craftsmanship and Diablo IV dark restrained gothic material richness. The OUTER border is a substantial 45px wide band of sculpted aged bronze, engraved curling botanical filigree and small rivets; heavier symmetrical ornate corner pieces, subtle worn golden edges. A small beautiful silver-bronze crest centered on the top border only, restrained stylized leaf wings, tiny dark garnet jewel. The interior is a completely EMPTY, very dark charcoal leather/slate surface with very fine subtle tactile texture, low contrast so live white text is readable. The interior occupies at least 84% of width and 88% of height. The edges of the rectangular frame reach the image edges, no background outside the object, no external shadow margin, no transparency needed. Mostly dark near-black warm brown interior with rich believable antique bronze frame. Front-on orthographic UI asset, high fidelity painted game asset, realistic materials, tasteful tiny scratches. Absolutely NO text, lettering, numbers, progress bars, dividers, icons, character portraits, inventory grid, scenery, watermarks, logos, pixels or modern rounded app cards. Do not render a mockup screen or a scene, only this single empty frame panel.
