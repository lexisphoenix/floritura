const assert = require("assert");
const fs = require("fs");
const os = require("os");
const opentype = require("opentype.js");
const fontApi = require("../js/font-features");

const fontPath = process.env.HOME + "/Library/Fonts/EBGaramond-Italic-wght.ttf";
if (!fs.existsSync(fontPath)) {
  console.log("skip: no está EB Garamond Italic en el usuario");
  process.exit(0);
}

const font = opentype.loadSync(fontPath);
const alternates = fontApi.listAlternates(font, "Q");
const swash = alternates.find((item) => item.glyphName === "Q.swsh");
assert.ok(swash, "Q debería tener la floritura Q.swsh");
assert.strictEqual(alternates[0].label, "Defecto");
assert.ok(!alternates.some((item) => item.feature === "aalt"), "aalt solo duplica variantes");

const contours = fontApi.contoursForGlyph(font, swash.glyph, 120);
assert.ok(contours.length > 0, "la floritura tiene contorno");
assert.ok(contours[0].vertices.length > 2);
assert.strictEqual(contours[0].vertices.length, contours[0].inTangents.length);
assert.strictEqual(contours[0].vertices.length, contours[0].outTangents.length);

const layout = fontApi.layoutWord(font, "Que", 0, swash.glyph, 100, 0);
assert.strictEqual(layout.items[0].special, true);
assert.ok(layout.items[1].x > layout.items[0].x);

const names = fontApi.readFontNames(fs.readFileSync(fontPath).buffer.slice(
  fs.readFileSync(fontPath).byteOffset,
  fs.readFileSync(fontPath).byteOffset + fs.readFileSync(fontPath).byteLength
));
assert.strictEqual(names.postScript, "EBGaramond-Italic");

const cabo = process.env.HOME + "/Library/Fonts/CaboRoyalSwashAM-BlackItalic.ttf";
if (fs.existsSync(cabo)) {
  const caboFont = opentype.loadSync(cabo);
  const width = fontApi.layoutWord(caboFont, "AV", -1, null, 100, 200).width;
  assert.ok(Math.abs(width - 243.1) < 0.2, "el ancho con tracking debe coincidir con After Effects, salió " + width);
}

const ttcPath = "/System/Library/Fonts/Supplemental/Hoefler Text.ttc";
if (fs.existsSync(ttcPath)) {
  const ttc = fs.readFileSync(ttcPath);
  const faces = fontApi.expandFaces(ttc);
  const black = faces.find((face) => face.names && face.names.postScript === "HoeflerText-BlackItalic");
  assert.ok(black, "la colección incluye Hoefler Text Black Italic");
  const hoefler = opentype.parse(black.buffer);
  const eAlts = fontApi.listAlternates(hoefler, "E", black.buffer);
  assert.ok(eAlts.some((item) => item.glyphName === "E.1"), "E debe mostrar la alternativa E.1, salió " + eAlts.map((item) => item.glyphName).join(", "));
  const eContours = fontApi.contoursForGlyph(hoefler, eAlts.find((item) => item.glyphName === "E.1").glyph, 120);
  assert.ok(eContours.length > 0 && eContours[0].vertices.length > 2);
}

console.log("ok", alternates.length, "variantes de Q,", contours.length, "contornos en Q.swsh");
