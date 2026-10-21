(function () {
  var fontApi = window.FlorituraFont;
  var state = {
    selection: null,
    font: null,
    fontPath: "",
    fontNames: null,
    charIndex: 0,
    alternates: [],
    selectedAlt: 0,
    busy: false,
    home: ""
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", function () {
    els.status = document.getElementById("status");
    els.meta = document.getElementById("meta");
    els.chars = document.getElementById("chars");
    els.grid = document.getElementById("grid");
    els.preview = document.getElementById("preview");
    els.size = document.getElementById("font-size");
    els.place = document.getElementById("place");
    els.restore = document.getElementById("restore");
    els.matches = document.getElementById("matches");
    document.getElementById("read").addEventListener("click", function () { readSelection(); });
    document.getElementById("pick").addEventListener("click", function () { pickFont(); });
    els.place.addEventListener("click", function () { placeOrUpdate(); });
    els.restore.addEventListener("click", function () { restoreText(); });
    els.size.addEventListener("change", function () { renderPreview(); });
    els.matches.addEventListener("change", function () {
      if (els.matches.value) loadFont(els.matches.value);
    });
    if (!window.__adobe_cep__) {
      setStatus("Ábrelo desde After Effects: Ventana → Extensiones (heredado) → Floritura.", true);
      return;
    }
    readSelection();
  });

  function setStatus(text, isError) {
    els.status.textContent = text || "";
    els.status.className = isError ? "status error" : "status";
  }

  function extensionPath() {
    var path = window.__adobe_cep__.getSystemPath("extension");
    if (path.indexOf("file://") === 0) path = decodeURI(path.replace("file://", ""));
    return path;
  }

  function evalHost(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, function (result) { resolve(result); });
    });
  }

  function jsxQuote(value) {
    return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  async function callHost(fn, payload) {
    var jsx = extensionPath() + "/jsx/host.jsx";
    var loaded = await evalHost("$.evalFile(" + jsxQuote(jsx) + ")");
    if (loaded === "EvalScript error.") {
      throw new Error("After Effects no pudo cargar el script del panel.");
    }
    var result;
    if (!payload) {
      result = await evalHost(fn + "()");
    } else {
      var file = "/tmp/floritura-" + fn + ".json";
      var write = window.cep.fs.writeFile(file, JSON.stringify(payload), window.cep.encoding.UTF8);
      if (!write || write.err) throw new Error("No se pudo preparar el envío a After Effects.");
      result = await evalHost(fn + "(" + jsxQuote(file) + ")");
    }
    if (!result || result === "EvalScript error.") {
      throw new Error("After Effects rechazó la operación.");
    }
    var parsed;
    try { parsed = JSON.parse(result); }
    catch (err) { throw new Error(result); }
    if (parsed.error) {
      throw new Error(parsed.line ? parsed.error + " (línea " + parsed.line + ")" : parsed.error);
    }
    return parsed;
  }

  async function readSelection() {
    if (state.busy) return;
    state.busy = true;
    setStatus("Leyendo la capa…");
    try {
      var data = await callHost("florituraReadSelection");
      if (data.home) state.home = data.home;
      if (!data.ok) {
        state.selection = null;
        render();
        setStatus(data.error || "No hay una capa de texto seleccionada.", true);
        return;
      }
      var sameLayer = state.selection && state.selection.compId === data.compId && state.selection.layerIndex === data.layerIndex && state.selection.mode === data.mode;
      var previousIndex = sameLayer ? state.charIndex : (data.meta ? data.meta.charIndex : 0);
      state.selection = data;
      state.charIndex = clampIndex(data.text, previousIndex);
      els.size.value = String(Math.round(data.fontSize));
      await ensureFont(data);
      render();
      setStatus("");
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      state.busy = false;
      render();
    }
  }

  function clampIndex(text, index) {
    if (!text || !text.length) return 0;
    if (index < 0 || index >= text.length) return 0;
    return index;
  }

  async function ensureFont(data) {
    if (state.fontNames && namesMatch(state.fontNames, data.font)) return;
    if (data.meta && data.meta.fontPath && fileExists(data.meta.fontPath)) {
      if (await loadFont(data.meta.fontPath, true, data.font)) return;
    }
    var remembered = rememberGet(data.font);
    if (remembered && fileExists(remembered)) {
      if (await loadFont(remembered, true, data.font)) return;
      rememberSet(data.font, "");
    }
    var direct = directFontPath(data.font);
    if (direct && fileExists(direct)) {
      if (await loadFont(direct, true, data.font)) {
        rememberSet(data.font, direct);
        return;
      }
    }
    var matches = await scanFonts(data.font);
    fillMatches(matches);
    if (matches.length === 1) {
      await loadFont(matches[0].path, true, data.font);
      return;
    }
    if (matches.length > 1) {
      setStatus("Hay varias fuentes con ese nombre. Elige cuál usar.");
      return;
    }
    state.font = null;
    state.faceBuffer = null;
    state.fontNames = null;
    state.fontPath = "";
    setStatus("No encuentro el archivo de " + data.font + ". Elige el .otf, .ttf o .ttc.", true);
  }

  function directFontPath(aeName) {
    if (aeName.indexOf("HoeflerText") === 0 || aeName.indexOf("Hoefler Text") === 0) {
      return "/System/Library/Fonts/Supplemental/Hoefler Text.ttc";
    }
    return "";
  }

  function fillMatches(matches) {
    els.matches.innerHTML = "";
    if (matches.length < 2) {
      els.matches.hidden = true;
      return;
    }
    els.matches.hidden = false;
    for (var i = 0; i < matches.length; i++) {
      var option = document.createElement("option");
      option.value = matches[i].path;
      option.textContent = matches[i].full || matches[i].postScript || matches[i].path;
      els.matches.appendChild(option);
    }
  }

  async function pickFont() {
    var dialog = window.cep.fs.showOpenDialogEx(false, false, "Elige la fuente", "", ["otf", "ttf", "ttc", "otc", "OTF", "TTF", "TTC", "OTC"]);
    var path = dialog && dialog.data && dialog.data[0];
    if (!path) return;
    var required = state.selection ? state.selection.font : "";
    var matched = await loadFont(path, false, required);
    if (!matched && required) await loadFont(path, false, "");
    if (state.selection && state.fontNames && namesMatch(state.fontNames, state.selection.font)) {
      rememberSet(state.selection.font, path);
    }
    render();
  }

  async function loadFont(path, quiet, requiredName) {
    setStatus(quiet ? "" : "Abriendo la fuente…");
    var res = window.cep.fs.readFile(path, window.cep.encoding.Base64);
    if (!res || res.err) throw new Error("No se pudo leer el archivo de la fuente.");
    var faces = fontApi.expandFaces(base64ToArrayBuffer(res.data));
    var face = null;
    for (var i = 0; i < faces.length; i++) {
      if (!requiredName || (faces[i].names && namesMatch(faces[i].names, requiredName))) face = faces[i];
    }
    if (requiredName && !face) return false;
    if (!face) face = faces[0];
    state.font = opentype.parse(face.buffer);
    state.faceBuffer = face.buffer;
    state.fontPath = path;
    state.fontNames = face.names || {
      postScript: state.font.getEnglishName("postScriptName") || "",
      full: state.font.getEnglishName("fullName") || "",
      family: state.font.getEnglishName("fontFamily") || ""
    };
    state.selectedAlt = 0;
    if (!quiet) setStatus("");
    return true;
  }

  async function scanFonts(aeName) {
    var dirs = fontDirectories();
    var found = [];
    for (var d = 0; d < dirs.length; d++) {
      var names = readDir(dirs[d]);
      for (var i = 0; i < names.length; i++) {
        var path = dirs[d] + "/" + names[i];
        var lower = names[i].toLowerCase();
        if (isFontFile(lower)) {
          var infos = fontFileNames(path);
          for (var f = 0; f < infos.length; f++) if (namesMatch(infos[f], aeName)) found.push(infos[f]);
        } else if (isDirectory(path)) {
          var nested = readDir(path);
          for (var n = 0; n < nested.length; n++) {
            var child = path + "/" + nested[n];
            var childLower = nested[n].toLowerCase();
            if (!isFontFile(childLower)) continue;
            var nestedInfos = fontFileNames(child);
            for (var m = 0; m < nestedInfos.length; m++) if (namesMatch(nestedInfos[m], aeName)) found.push(nestedInfos[m]);
          }
        }
      }
      if (found.length) break;
    }
    return found;
  }

  function fontDirectories() {
    var home = state.home || "";
    var dirs = [];
    if (home) dirs.push(home + "/Library/Fonts");
    dirs.push("/Library/Fonts");
    dirs.push("/System/Library/Fonts");
    var existing = [];
    for (var i = 0; i < dirs.length; i++) if (isDirectory(dirs[i])) existing.push(dirs[i]);
    return existing;
  }

  function statIsFile(data) {
    if (!data || !data.isFile) return false;
    return typeof data.isFile === "function" ? data.isFile() : !!data.isFile;
  }

  function statIsDirectory(data) {
    if (!data || !data.isDirectory) return false;
    return typeof data.isDirectory === "function" ? data.isDirectory() : !!data.isDirectory;
  }

  function isFontFile(name) {
    return name.endsWith(".ttf") || name.endsWith(".otf") || name.endsWith(".ttc") || name.endsWith(".otc");
  }

  function fontFileNames(path) {
    var stat = window.cep.fs.stat(path);
    if (!stat || stat.err || !statIsFile(stat.data)) return [];
    if (stat.data.size && stat.data.size > 8000000) return [];
    var res = window.cep.fs.readFile(path, window.cep.encoding.Base64);
    if (!res || res.err) return [];
    var faces = fontApi.expandFaces(base64ToArrayBuffer(res.data));
    var infos = [];
    for (var i = 0; i < faces.length; i++) {
      if (!faces[i].names) continue;
      faces[i].names.path = path;
      infos.push(faces[i].names);
    }
    return infos;
  }

  function namesMatch(info, aeName) {
    var target = norm(aeName);
    if (!target) return false;
    return norm(info.postScript) === target || norm(info.full) === target;
  }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function readDir(path) {
    var res = window.cep.fs.readdir(path);
    if (!res || res.err || !res.data) return [];
    return res.data;
  }

  function isDirectory(path) {
    var stat = window.cep.fs.stat(path);
    return !!(stat && !stat.err && statIsDirectory(stat.data));
  }

  function fileExists(path) {
    var stat = window.cep.fs.stat(path);
    return !!(stat && !stat.err && statIsFile(stat.data));
  }

  function base64ToArrayBuffer(b64) {
    var clean = String(b64 || "").replace(/\s/g, "");
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function rememberGet(fontName) {
    try {
      var map = JSON.parse(localStorage.getItem("floritura.fonts") || "{}");
      return map[fontName] || "";
    } catch (err) { return ""; }
  }

  function rememberSet(fontName, path) {
    if (!fontName) return;
    var map = {};
    try { map = JSON.parse(localStorage.getItem("floritura.fonts") || "{}"); } catch (err) {}
    if (path) map[fontName] = path;
    else delete map[fontName];
    localStorage.setItem("floritura.fonts", JSON.stringify(map));
  }

  function currentGlyph() {
    if (!state.alternates.length) return null;
    return state.alternates[Math.min(state.selectedAlt, state.alternates.length - 1)];
  }

  function fontSize() {
    var size = Number(els.size.value);
    if (!size || size < 1) return state.selection ? state.selection.fontSize : 100;
    return size;
  }

  function render() {
    var data = state.selection;
    els.place.disabled = true;
    els.restore.hidden = !data || data.mode !== "edit";
    if (!data) {
      els.meta.textContent = "Ninguna capa leída.";
      els.chars.innerHTML = "";
      els.grid.innerHTML = "";
      clearCanvas(els.preview);
      return;
    }
    var fontNote = state.fontNames ? (state.fontNames.full || state.fontNames.postScript) : "archivo sin elegir";
    els.meta.innerHTML = "<strong>" + escapeHtml(data.layerName) + "</strong><br>" + escapeHtml(data.font) + " · " + escapeHtml(fontNote);
    renderChars(data.text);
    if (state.font) {
      state.alternates = fontApi.listAlternates(state.font, data.text.charAt(state.charIndex) || "", state.faceBuffer);
      if (data.mode === "edit" && data.meta && data.meta.glyphIndex) {
        for (var i = 0; i < state.alternates.length; i++) {
          if (state.alternates[i].glyphIndex === data.meta.glyphIndex) state.selectedAlt = i;
        }
      }
      if (state.selectedAlt >= state.alternates.length) state.selectedAlt = 0;
    } else {
      state.alternates = [];
    }
    renderGrid();
    renderPreview();
    var alt = currentGlyph();
    var blocked = data.boxText || data.multiline || !state.font || !alt;
    els.place.disabled = blocked || state.busy || (data.mode === "create" && state.selectedAlt === 0);
    els.place.textContent = data.mode === "edit" ? "Actualizar letra" : "Colocar en la composición";
    if (data.boxText) setStatus("De momento funciona con texto de punto, no con una caja.", true);
    else if (data.multiline) setStatus("De momento la palabra tiene que estar en una sola línea.", true);
    else if (state.fontNames && !namesMatch(state.fontNames, data.font)) {
      setStatus("Este archivo no es la fuente de la capa. La floritura saldrá de " + (state.fontNames.full || state.fontNames.postScript) + ".");
    }
  }

  function renderChars(text) {
    els.chars.innerHTML = "";
    for (var i = 0; i < text.length; i++) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "char" + (i === state.charIndex ? " active" : "");
      button.textContent = text.charAt(i) === " " ? "·" : text.charAt(i);
      button.title = text.charAt(i);
      button.addEventListener("click", charClick(i));
      els.chars.appendChild(button);
    }
  }

  function charClick(index) {
    return function () {
      state.charIndex = index;
      state.selectedAlt = 0;
      render();
    };
  }

  function renderGrid() {
    els.grid.innerHTML = "";
    if (!state.font) {
      els.grid.textContent = "Elige el archivo de la fuente para ver las variantes.";
      return;
    }
    if (state.alternates.length < 2) {
      els.grid.textContent = "Esta letra no tiene variantes en el archivo.";
      return;
    }
    for (var i = 0; i < state.alternates.length; i++) {
      var alt = state.alternates[i];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "glyph" + (i === state.selectedAlt ? " active" : "");
      button.title = alt.glyphName;
      var canvas = document.createElement("canvas");
      button.appendChild(canvas);
      var label = document.createElement("span");
      label.textContent = alt.label;
      button.appendChild(label);
      drawGlyph(canvas, alt.glyph);
      button.addEventListener("click", altClick(i));
      els.grid.appendChild(button);
    }
  }

  function altClick(index) {
    return function () {
      state.selectedAlt = index;
      renderGrid();
      renderPreview();
      var data = state.selection;
      els.place.disabled = !data || data.boxText || data.multiline || !state.font || (data.mode === "create" && index === 0);
    };
  }

  function drawGlyph(canvas, glyph) {
    var ctx = fitCanvas(canvas, 84, 64);
    ctx.clearRect(0, 0, 84, 64);
    if (!glyph || !state.font) return;
    var size = 52;
    var scale = size / state.font.unitsPerEm;
    var box = glyph.getBoundingBox();
    var width = (box.x2 - box.x1) * scale;
    var x = (84 - width) / 2 - box.x1 * scale;
    var path = glyph.getPath(x, 52, size);
    path.fill = "#f4efe6";
    path.draw(ctx);
  }

  function renderPreview() {
    var canvas = els.preview;
    var wrap = canvas.parentNode;
    var cssW = Math.max(240, wrap.clientWidth || 280);
    var cssH = 92;
    var ctx = fitCanvas(canvas, cssW, cssH);
    ctx.clearRect(0, 0, cssW, cssH);
    var data = state.selection;
    var alt = currentGlyph();
    if (!data || !state.font || !alt) return;
    var text = data.text.split("\r").join(" ").split("\n").join(" ");
    var previewSize = 64;
    var layout = fontApi.layoutWord(state.font, text, state.charIndex, alt.glyph, previewSize, data.tracking);
    var pad = 16;
    var scale = layout.width > 0 ? Math.min(1, (cssW - pad * 2) / layout.width) : 1;
    var baseline = 68;
    var offset = (cssW - layout.width * scale) / 2;
    for (var i = 0; i < layout.items.length; i++) {
      var item = layout.items[i];
      var path = item.glyph.getPath(0, 0, previewSize);
      ctx.save();
      ctx.translate(offset + item.x * scale, baseline);
      ctx.scale(scale, scale);
      path.fill = item.special ? "#e2b56a" : "#f4efe6";
      path.draw(ctx);
      ctx.restore();
    }
  }

  function clearCanvas(canvas) {
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function fitCanvas(canvas, cssW, cssH) {
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssW * ratio));
    canvas.height = Math.max(1, Math.round(cssH * ratio));
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  async function placeOrUpdate() {
    var data = state.selection;
    var alt = currentGlyph();
    if (!data || !state.font || !alt || state.busy) return;
    if (data.mode === "edit" && state.selectedAlt === 0) {
      await restoreText();
      return;
    }
    state.busy = true;
    els.place.disabled = true;
    setStatus(data.mode === "edit" ? "Actualizando la letra…" : "Colocando la letra…");
    try {
      var payload = buildPayload(data, alt);
      var fn = data.mode === "edit" ? "florituraUpdate" : "florituraApply";
      await callHost(fn, payload);
      if (state.selection) rememberSet(state.selection.font, state.fontPath);
      await readSelection();
      setStatus(data.mode === "edit" ? "Letra actualizada. La composición conserva el fundido y los efectos." : "Letra colocada. La palabra queda en su composición, con el fundido y los efectos.");
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function restoreText() {
    var data = state.selection;
    if (!data || !data.meta || state.busy) return;
    state.busy = true;
    setStatus("Volviendo a texto…");
    try {
      await callHost("florituraRestore", { groupId: data.meta.groupId });
      await readSelection();
      setStatus("La palabra ha vuelto a ser texto.");
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      state.busy = false;
      render();
    }
  }

  function buildPayload(data, alt) {
    var size = fontSize();
    var text = data.text;
    var index = state.charIndex;
    var beforeChar = index > 0 ? state.font.charToGlyph(text.charAt(index - 1)) : null;
    var afterChar = index < text.length - 1 ? state.font.charToGlyph(text.charAt(index + 1)) : null;
    return {
      compId: data.compId || 0,
      layerIndex: data.layerIndex,
      layerName: data.layerName,
      groupId: data.meta ? data.meta.groupId : "",
      charIndex: index,
      character: text.charAt(index),
      glyphName: alt.glyphName,
      glyphIndex: alt.glyphIndex,
      feature: alt.feature,
      fontPath: state.fontPath,
      fontPsName: state.fontNames ? state.fontNames.postScript : data.font,
      fontSize: size,
      tracking: data.tracking || 0,
      align: data.align,
      fillColor: data.fillColor,
      applyFill: data.applyFill,
      stroke: data.stroke,
      advance: fontApi.advancePixels(state.font, alt.glyph, size),
      kernBefore: fontApi.kernPixels(state.font, beforeChar, alt.glyph, size),
      kernAfter: fontApi.kernPixels(state.font, alt.glyph, afterChar, size),
      contours: fontApi.contoursForGlyph(state.font, alt.glyph, size)
    };
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
