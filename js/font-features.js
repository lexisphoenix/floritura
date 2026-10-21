(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FlorituraFont = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  var SKIP = {
    aalt: true,
    locl: true,
    kern: true,
    mark: true,
    mkmk: true,
    rclt: true,
    size: true,
    vert: true,
    vrt2: true,
    ccmp: true
  };

  var PREFERRED = ["swsh", "cswh", "salt", "hist", "titl", "ornm", "calt", "fina", "init", "medi", "dlig", "liga", "hlig"];

  var LABELS = {
    swsh: "Swash",
    cswh: "Swash contextual",
    salt: "Alternativa",
    hist: "Histórica",
    titl: "Titular",
    ornm: "Ornamento",
    calt: "Contextual",
    fina: "Final",
    init: "Inicial",
    medi: "Media",
    dlig: "Ligadura discrecional",
    liga: "Ligadura",
    hlig: "Ligadura histórica",
    smcp: "Versalitas",
    c2sc: "Versalitas de caja alta",
    pcap: "Petite caps",
    c2pc: "Petite de caja alta",
    case: "Caja",
    onum: "Números elzevirianos",
    lnum: "Números alineados",
    pnum: "Números proporcionales",
    tnum: "Números tabulares",
    sups: "Superíndice",
    subs: "Subíndice",
    sinf: "Inferior",
    ordn: "Ordinal",
    frac: "Fracción",
    numr: "Numerador",
    dnom: "Denominador"
  };

  function featureRank(tag) {
    var index = PREFERRED.indexOf(tag);
    if (index >= 0) return index;
    if (/^ss\d\d$/.test(tag)) return 20 + parseInt(tag.slice(2), 10);
    if (/^cv\d\d$/.test(tag)) return 50 + parseInt(tag.slice(2), 10);
    return 80;
  }

  function featureLabel(tag) {
    if (LABELS[tag]) return LABELS[tag];
    if (/^ss\d\d$/.test(tag)) return "Set " + parseInt(tag.slice(2), 10);
    if (/^cv\d\d$/.test(tag)) return "Variante " + parseInt(tag.slice(2), 10);
    return tag;
  }

  function coverageIndex(coverage, glyphId) {
    if (!coverage) return -1;
    var glyphs = coverage.glyphs;
    if (glyphs && glyphs.length) {
      for (var i = 0; i < glyphs.length; i++) {
        if (glyphs[i] === glyphId) return i;
      }
    }
    var ranges = coverage.ranges || [];
    for (var r = 0; r < ranges.length; r++) {
      var range = ranges[r];
      if (glyphId >= range.start && glyphId <= range.end) {
        return range.index + (glyphId - range.start);
      }
    }
    return -1;
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  function pushAlternate(found, seen, font, glyphIndex, feature, label, rank) {
    if (!glyphIndex || seen[glyphIndex]) return;
    var glyph = font.glyphs.get(glyphIndex);
    if (!glyph) return;
    seen[glyphIndex] = true;
    found.push({
      feature: feature,
      label: label,
      glyphName: glyph.name || ("gid" + glyphIndex),
      glyphIndex: glyphIndex,
      glyph: glyph,
      rank: rank
    });
  }

  function addNamedAlternates(font, base, found, seen) {
    var baseName = base.name;
    if (!baseName) return;
    var prefix = baseName + ".";
    for (var i = 0; i < font.glyphs.length; i++) {
      var glyph = font.glyphs.get(i);
      if (!glyph || !glyph.name || glyph.name.indexOf(prefix) !== 0) continue;
      var rest = glyph.name.slice(prefix.length);
      var label = "";
      var rank = 12;
      if (rest === "1") label = "Alternativa";
      else if (rest === "2" || rest === "3") label = "Alternativa " + rest;
      else if (rest.indexOf("swash.li") === 0) {
        label = "Swash inicial";
        rank = 4;
      } else if (rest.indexOf("swash") === 0) {
        label = "Swash";
        rank = 4;
      } else continue;
      pushAlternate(found, seen, font, glyph.index, "aat", label, rank);
    }
  }

  function aatLabel(featureType, setting) {
    if (featureType === 8) return "Swash";
    if (featureType === 3) return "Versalitas";
    if (featureType === 1) return "Ligadura";
    if (featureType === 17) return setting > 1 ? "Alternativa " + setting : "Alternativa";
    return "Alternativa";
  }

  function addMorxAlternates(buffer, font, base, found, seen) {
    if (!buffer) return;
    var view = new DataView(buffer);
    var scaler = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (scaler === "ttcf") return;
    var count = view.getUint16(4);
    var morx = null;
    for (var i = 0; i < count; i++) {
      var rec = 12 + i * 16;
      var tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
      if (tag === "morx") morx = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
    }
    if (!morx || view.getUint16(morx.offset) !== 2) return;
    var p = morx.offset + 4;
    var nChains = view.getUint32(p);
    p += 4;
    for (var c = 0; c < nChains; c++) {
      var chainStart = p;
      p += 4;
      var chainLength = view.getUint32(p);
      p += 4;
      var nFeat = view.getUint32(p);
      p += 4;
      var nSub = view.getUint32(p);
      p += 4;
      var flagLabel = {};
      for (var f = 0; f < nFeat; f++) {
        var featureType = view.getUint16(p);
        var setting = view.getUint16(p + 2);
        var enable = view.getUint32(p + 4);
        if (enable) flagLabel[enable] = aatLabel(featureType, setting);
        p += 12;
      }
      for (var s = 0; s < nSub; s++) {
        var subStart = p;
        var length = view.getUint32(p);
        var type = view.getUint32(p + 4) & 255;
        var flags = view.getUint32(p + 8);
        if (type === 4) {
          var lookup = p + 12;
          if (view.getUint16(lookup) === 0 && lookup + 4 + base.index * 2 <= subStart + length) {
            var repl = view.getUint16(lookup + 2 + base.index * 2);
            if (repl && repl !== base.index) {
              pushAlternate(found, seen, font, repl, "aat", flagLabel[flags] || "Alternativa", 12);
            }
          }
        }
        p = subStart + length;
      }
      p = chainStart + chainLength;
    }
  }

  function asArrayBuffer(input) {
    if (input instanceof ArrayBuffer) return input;
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }

  function extractFace(buffer, faceIndex) {
    var view = new DataView(buffer);
    var base = view.getUint32(12 + faceIndex * 4);
    var nTables = view.getUint16(base + 4);
    var records = [];
    for (var t = 0; t < nTables; t++) {
      var rec = base + 12 + t * 16;
      records.push({
        tag: String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3)),
        checksum: view.getUint32(rec + 4),
        offset: view.getUint32(rec + 8),
        length: view.getUint32(rec + 12)
      });
    }
    records.sort(function (a, b) { return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0; });
    var cursor = 12 + nTables * 16;
    var placed = [];
    for (var r = 0; r < records.length; r++) {
      var start = cursor;
      cursor += records[r].length + (4 - (records[r].length % 4)) % 4;
      placed.push({ rec: records[r], start: start });
    }
    var out = new Uint8Array(cursor);
    var outView = new DataView(out.buffer);
    out.set(new Uint8Array(buffer, base, 12), 0);
    for (var i = 0; i < placed.length; i++) {
      var chunk = placed[i];
      var recPos = 12 + i * 16;
      for (var c = 0; c < 4; c++) out[recPos + c] = chunk.rec.tag.charCodeAt(c);
      outView.setUint32(recPos + 4, chunk.rec.checksum);
      outView.setUint32(recPos + 8, chunk.start);
      outView.setUint32(recPos + 12, chunk.rec.length);
      out.set(new Uint8Array(buffer, chunk.rec.offset, chunk.rec.length), chunk.start);
    }
    return out.buffer;
  }

  function expandFaces(input) {
    var buffer = asArrayBuffer(input);
    var view = new DataView(buffer);
    var tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (tag !== "ttcf") return [{ buffer: buffer, names: readFontNames(buffer) }];
    var num = view.getUint32(8);
    var faces = [];
    for (var i = 0; i < num; i++) {
      var face = extractFace(buffer, i);
      faces.push({ buffer: face, names: readFontNames(face) });
    }
    return faces;
  }

  function listAlternates(font, character, faceBuffer) {
    var base = font.charToGlyph(character);
    var results = [{
      feature: "",
      label: "Defecto",
      glyphName: base.name,
      glyphIndex: base.index,
      glyph: base
    }];
    if (!base || (base.index === 0 && base.name === ".notdef")) return results;

    var seen = {};
    seen[base.index] = true;
    var found = [];
    var gsub = font.tables && font.tables.gsub;

    if (gsub && gsub.features) {
    for (var f = 0; f < gsub.features.length; f++) {
      var feature = gsub.features[f];
      var tag = feature.tag;
      if (SKIP[tag]) continue;
      var indexes = feature.feature && feature.feature.lookupListIndexes;
      if (!indexes) continue;
      for (var i = 0; i < indexes.length; i++) {
        var lookup = gsub.lookups[indexes[i]];
        if (!lookup || (lookup.lookupType !== 1 && lookup.lookupType !== 3)) continue;
        var subtables = lookup.subtables || [];
        for (var s = 0; s < subtables.length; s++) {
          var subtable = subtables[s];
          var coverIndex = coverageIndex(subtable.coverage, base.index);
          if (coverIndex < 0) continue;
          var targets = [];
          if (lookup.lookupType === 1) {
            if (subtable.substitute && subtable.substitute.length > coverIndex) {
              targets.push(subtable.substitute[coverIndex]);
            } else if (typeof subtable.deltaGlyphId === "number") {
              targets.push(base.index + subtable.deltaGlyphId);
            }
          } else if (subtable.alternateSets && subtable.alternateSets[coverIndex]) {
            targets = subtable.alternateSets[coverIndex];
          }
          for (var t = 0; t < targets.length; t++) {
            var glyphIndex = targets[t];
            if (!glyphIndex || seen[glyphIndex]) continue;
            var glyph = font.glyphs.get(glyphIndex);
            if (!glyph) continue;
            seen[glyphIndex] = true;
            found.push({
              feature: tag,
              label: featureLabel(tag),
              glyphName: glyph.name || ("gid" + glyphIndex),
              glyphIndex: glyphIndex,
              glyph: glyph,
              rank: featureRank(tag)
            });
          }
        }
      }
    }
    }

    addNamedAlternates(font, base, found, seen);
    addMorxAlternates(faceBuffer, font, base, found, seen);

    found.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.glyphName < b.glyphName ? -1 : a.glyphName > b.glyphName ? 1 : 0;
    });
    for (var n = 0; n < found.length; n++) results.push(found[n]);
    return results;
  }

  function trackingPixels(tracking, fontSize) {
    return (Number(tracking) || 0) / 1000 * fontSize;
  }

  function kernPixels(font, leftGlyph, rightGlyph, fontSize) {
    if (!font || !leftGlyph || !rightGlyph) return 0;
    return font.getKerningValue(leftGlyph, rightGlyph) * fontSize / font.unitsPerEm;
  }

  function advancePixels(font, glyph, fontSize) {
    return (glyph.advanceWidth || 0) * fontSize / font.unitsPerEm;
  }

  function contoursForGlyph(font, glyph, fontSize) {
    var path = glyph.getPath(0, 0, fontSize);
    var commands = path.commands || [];
    var contours = [];
    var current = null;

    function startContour(x, y) {
      current = {
        vertices: [[round3(x), round3(y)]],
        inTangents: [[0, 0]],
        outTangents: [[0, 0]]
      };
    }

    for (var i = 0; i < commands.length; i++) {
      var command = commands[i];
      if (command.type === "M") {
        if (current && current.vertices.length > 1) contours.push(current);
        startContour(command.x, command.y);
      } else if (!current) {
        continue;
      } else if (command.type === "L") {
        current.vertices.push([round3(command.x), round3(command.y)]);
        current.inTangents.push([0, 0]);
        current.outTangents.push([0, 0]);
      } else if (command.type === "C" || command.type === "Q") {
        var from = current.vertices[current.vertices.length - 1];
        var toX = command.x;
        var toY = command.y;
        var c1x;
        var c1y;
        var c2x;
        var c2y;
        if (command.type === "Q") {
          c1x = from[0] + (2 / 3) * (command.x1 - from[0]);
          c1y = from[1] + (2 / 3) * (command.y1 - from[1]);
          c2x = toX + (2 / 3) * (command.x1 - toX);
          c2y = toY + (2 / 3) * (command.y1 - toY);
        } else {
          c1x = command.x1;
          c1y = command.y1;
          c2x = command.x2;
          c2y = command.y2;
        }
        var last = current.outTangents.length - 1;
        current.outTangents[last] = [round3(c1x - from[0]), round3(c1y - from[1])];
        current.vertices.push([round3(toX), round3(toY)]);
        current.inTangents.push([round3(c2x - toX), round3(c2y - toY)]);
        current.outTangents.push([0, 0]);
      } else if (command.type === "Z") {
        closeContour(current);
        if (current && current.vertices.length > 1) contours.push(current);
        current = null;
      }
    }
    if (current && current.vertices.length > 1) contours.push(current);
    return contours;
  }

  function closeContour(contour) {
    if (!contour || contour.vertices.length < 2) return;
    var last = contour.vertices[contour.vertices.length - 1];
    var first = contour.vertices[0];
    if (Math.abs(last[0] - first[0]) > 0.05 || Math.abs(last[1] - first[1]) > 0.05) return;
    contour.inTangents[0] = contour.inTangents[contour.inTangents.length - 1];
    contour.vertices.pop();
    contour.inTangents.pop();
    contour.outTangents.pop();
  }

  function layoutWord(font, text, charIndex, altGlyph, fontSize, tracking) {
    var gap = trackingPixels(tracking, fontSize);
    var items = [];
    var x = 0;
    var prev = null;
    for (var i = 0; i < text.length; i++) {
      var glyph = i === charIndex && altGlyph ? altGlyph : font.charToGlyph(text.charAt(i));
      if (prev) x += kernPixels(font, prev, glyph, fontSize);
      items.push({ glyph: glyph, x: x, special: i === charIndex, character: text.charAt(i) });
      x += advancePixels(font, glyph, fontSize) + gap;
      prev = glyph;
    }
    return { items: items, width: x };
  }

  function readFontNames(buffer) {
    var view = buffer instanceof DataView ? buffer : new DataView(buffer);
    if (view.byteLength < 12) return null;
    var numTables = view.getUint16(4);
    var nameOffset = 0;
    for (var i = 0; i < numTables; i++) {
      var rec = 12 + i * 16;
      if (rec + 16 > view.byteLength) return null;
      var tag = String.fromCharCode(
        view.getUint8(rec),
        view.getUint8(rec + 1),
        view.getUint8(rec + 2),
        view.getUint8(rec + 3)
      );
      if (tag === "name") {
        nameOffset = view.getUint32(rec + 8);
        break;
      }
    }
    if (!nameOffset || nameOffset + 6 > view.byteLength) return null;
    var count = view.getUint16(nameOffset + 2);
    var stringOffset = view.getUint16(nameOffset + 4);
    var names = {};
    for (var n = 0; n < count; n++) {
      var row = nameOffset + 6 + n * 12;
      if (row + 12 > view.byteLength) break;
      var platform = view.getUint16(row);
      var nameId = view.getUint16(row + 6);
      var length = view.getUint16(row + 8);
      var offset = view.getUint16(row + 10);
      if (nameId !== 1 && nameId !== 4 && nameId !== 6 && nameId !== 16) continue;
      var start = nameOffset + stringOffset + offset;
      if (start + length > view.byteLength) continue;
      var text = "";
      if (platform === 3 || platform === 0) {
        for (var c = 0; c < length; c += 2) text += String.fromCharCode(view.getUint16(start + c));
      } else {
        for (var b = 0; b < length; b++) text += String.fromCharCode(view.getUint8(start + b));
      }
      if (!names[nameId] || platform === 3) names[nameId] = text;
    }
    return {
      family: names[16] || names[1] || "",
      full: names[4] || "",
      postScript: names[6] || ""
    };
  }

  return {
    listAlternates: listAlternates,
    expandFaces: expandFaces,
    contoursForGlyph: contoursForGlyph,
    advancePixels: advancePixels,
    kernPixels: kernPixels,
    trackingPixels: trackingPixels,
    layoutWord: layoutWord,
    readFontNames: readFontNames,
    featureLabel: featureLabel
  };
});
