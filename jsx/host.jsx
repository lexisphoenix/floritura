function florituraReadSelection() {
    var home = "";
    try {
        home = Folder.myDocuments.parent.fsName;
    } catch (homeError) {}
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return florituraJson({ error: "Abre una composición.", home: home });
        }
        if (!comp.selectedLayers || comp.selectedLayers.length === 0) {
            return florituraJson({ error: "Selecciona una capa de texto.", home: home });
        }
        var layer = comp.selectedLayers[0];
        var opened = florituraOpenContainer(layer);
        if (opened) {
            comp = opened.comp;
            layer = opened.layer;
        }
        var metaHit = florituraFindMeta(layer);
        if (metaHit) {
            var group = florituraGroup(comp, metaHit.meta.groupId);
            var source = group.original || metaHit.layer;
            var sourceDoc = florituraTextDocument(source);
            if (!sourceDoc) {
                return florituraJson({ error: "No encuentro el texto original de esta floritura.", home: home });
            }
            return florituraJson({
                ok: true,
                mode: "edit",
                home: home,
                compName: comp.name,
                compId: comp.id,
                layerIndex: source.index,
                layerName: source.name,
                text: sourceDoc.text,
                font: sourceDoc.font,
                fontSize: sourceDoc.fontSize,
                tracking: sourceDoc.tracking || 0,
                align: florituraAlign(sourceDoc),
                fillColor: florituraFill(sourceDoc),
                applyFill: sourceDoc.applyFill !== false,
                stroke: florituraStroke(sourceDoc),
                boxText: !!sourceDoc.boxText,
                multiline: florituraIsMultiline(sourceDoc.text),
                meta: metaHit.meta
            });
        }
        if (!(layer instanceof TextLayer)) {
            return florituraJson({ error: "Selecciona una capa de texto.", home: home });
        }
        var doc = florituraTextDocument(layer);
        return florituraJson({
            ok: true,
            mode: "create",
            home: home,
            compName: comp.name,
            compId: comp.id,
            layerIndex: layer.index,
            layerName: layer.name,
            text: doc.text,
            font: doc.font,
            fontSize: doc.fontSize,
            tracking: doc.tracking || 0,
            align: florituraAlign(doc),
            fillColor: florituraFill(doc),
            applyFill: doc.applyFill !== false,
            stroke: florituraStroke(doc),
            boxText: !!doc.boxText,
            multiline: florituraIsMultiline(doc.text)
        });
    } catch (err) {
        return florituraJson({ error: String(err), line: err.line, home: home });
    }
}

function florituraApply(path) {
    return florituraMutate(path, "apply");
}

function florituraUpdate(path) {
    return florituraMutate(path, "update");
}

function florituraRestore(path) {
    return florituraMutate(path, "restore");
}

function florituraMutate(path, action) {
    var comp = null;
    try {
        var payload = florituraReadPayload(path);
        comp = florituraCompFromPayload(payload);
        if (!comp) return florituraJson({ error: "Abre una composición." });
        app.beginUndoGroup(action === "restore" ? "Quitar floritura" : "Floritura");
        var result;
        if (action === "apply") result = florituraApplyInComp(comp, payload);
        else if (action === "update") result = florituraUpdateInComp(comp, payload);
        else result = florituraRestoreInComp(comp, payload);
        app.endUndoGroup();
        return florituraJson(result);
    } catch (err) {
        try { app.endUndoGroup(); } catch (endError) {}
        return florituraJson({ error: String(err), line: err.line });
    }
}

function florituraApplyInComp(comp, payload) {
    var layer = null;
    try {
        layer = florituraRequireTextLayer(comp, payload);
    } catch (missing) {
        var active = app.project.activeItem;
        if (active && (active instanceof CompItem) && active.selectedLayers && active.selectedLayers.length) {
            var opened = florituraOpenContainer(active.selectedLayers[0]);
            if (opened && opened.layer.name === payload.layerName) {
                comp = opened.comp;
                layer = opened.layer;
            }
        }
        if (!layer) throw missing;
    }
    if (layer.locked) throw new Error("Desbloquea la capa de texto.");
    if (florituraFindMeta(layer)) throw new Error("Esa capa ya tiene una floritura. Actualízala desde el panel.");
    var doc = florituraTextDocument(layer);
    florituraCheckText(doc, payload);
    var wrapped = florituraEnsurePrecomp(comp, layer);
    var built = florituraCreatePieces(wrapped.comp, wrapped.layer, payload, florituraNewId());
    florituraSyncOuter(wrapped.comp, florituraParseMeta(wrapped.layer.comment));
    florituraSelectOuter(wrapped);
    return { ok: true, groupId: built.groupId };
}

function florituraUpdateInComp(comp, payload) {
    var located = florituraLocateGroup(comp, payload.groupId);
    if (!located.group.original) throw new Error("No encuentro la capa original de esta floritura.");
    if (located.group.original.locked) throw new Error("Desbloquea la capa de texto.");
    var wrapped = florituraEnsurePrecomp(located.comp, located.group.original);
    var group = florituraGroup(wrapped.comp, payload.groupId);
    if (!group.original) throw new Error("No encuentro la capa original de esta floritura.");
    var doc = florituraTextDocument(group.original);
    florituraCheckText(doc, payload);
    florituraApplyStyle(group.original, payload);
    var layout = florituraLayout(group.original, payload);
    florituraWritePieces(wrapped.comp, group, group.original, payload, layout);
    florituraSyncOuter(wrapped.comp, florituraParseMeta(group.original.comment));
    florituraSelectOuter(wrapped);
    return { ok: true, groupId: payload.groupId };
}

function florituraRestoreInComp(comp, payload) {
    var located = florituraLocateGroup(comp, payload.groupId);
    var group = located.group;
    if (group.before) group.before.remove();
    if (group.after) group.after.remove();
    if (group.shape) group.shape.remove();
    if (group.original) florituraRestoreSource(group.original, payload);
    var outer = florituraOuterFor(located.comp);
    if (outer) outer.comment = "";
    return { ok: true };
}

function florituraCompFromPayload(payload) {
    if (payload && payload.compId) {
        var item = app.project.itemByID(payload.compId);
        if (item && (item instanceof CompItem)) return item;
    }
    var active = app.project.activeItem;
    if (!active || !(active instanceof CompItem)) return null;
    return active;
}

function florituraLocateGroup(comp, groupId) {
    if (comp && groupId) {
        var direct = florituraGroup(comp, groupId);
        if (direct.original || direct.shape) return { comp: comp, group: direct };
    }
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem)) continue;
        var found = florituraGroup(item, groupId);
        if (found.original || found.shape) return { comp: item, group: found };
    }
    return { comp: comp, group: { original: null, before: null, after: null, shape: null } };
}

function florituraOpenContainer(layer) {
    var meta = florituraParseMeta(layer.comment);
    if (meta && meta.role === "comp" && meta.compId) {
        var marked = app.project.itemByID(meta.compId);
        if (marked && (marked instanceof CompItem)) {
            var markedGroup = florituraGroup(marked, meta.groupId);
            if (markedGroup.original) return { comp: marked, layer: markedGroup.original };
        }
    }
    var source = null;
    try { source = layer.source; } catch (sourceError) {}
    if (!(source instanceof CompItem)) return null;
    var innerMeta = florituraFirstMeta(source);
    if (innerMeta) {
        var group = florituraGroup(source, innerMeta.groupId);
        if (group.original) return { comp: source, layer: group.original };
    }
    var only = florituraSingleText(source);
    if (only) return { comp: source, layer: only };
    return null;
}

function florituraFirstMeta(comp) {
    var fallback = null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var meta = florituraParseMeta(comp.layer(i).comment);
        if (!meta) continue;
        if (meta.role === "original") return meta;
        if (!fallback) fallback = meta;
    }
    return fallback;
}

function florituraSingleText(comp) {
    var found = null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer instanceof TextLayer) {
            if (found) return null;
            found = layer;
        } else if (layer.enabled) {
            return null;
        }
    }
    return found;
}

function florituraOuterFor(comp) {
    if (!comp) return null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof CompItem) || item === comp) continue;
        for (var l = 1; l <= item.numLayers; l++) {
            var layer = item.layer(l);
            try {
                if (layer.source === comp) return layer;
            } catch (sourceError) {}
        }
    }
    return null;
}

function florituraEnsurePrecomp(comp, textLayer) {
    if (florituraIsContainer(comp)) return { comp: comp, layer: textLayer, outer: florituraOuterFor(comp) };
    return florituraWrap(comp, textLayer);
}

function florituraIsContainer(comp) {
    var meta = florituraParseMeta(comp.comment);
    return !!(meta && meta.role === "container");
}

function florituraWrap(parentComp, textLayer) {
    var moving = florituraMovingLayers(parentComp, textLayer);
    var i;
    for (i = 0; i < moving.length; i++) {
        if (moving[i].locked) throw new Error("Desbloquea las capas de la palabra.");
    }
    var inner = app.project.items.addComp(textLayer.name, parentComp.width, parentComp.height, parentComp.pixelAspect, parentComp.duration, parentComp.frameRate);
    inner.comment = JSON.stringify({ floritura: 1, role: "container" });
    var outer = null;
    try {
        var top = moving[0];
        for (i = 1; i < moving.length; i++) if (moving[i].index < top.index) top = moving[i];
        var above = top.index > 1 ? parentComp.layer(top.index - 1) : null;
        var locals = florituraRememberLocals(moving);
        var descending = florituraSortByIndex(moving, true);
        for (i = 0; i < descending.length; i++) descending[i].copyToComp(inner);
        florituraReparentCopies(inner, locals);
        outer = parentComp.layers.add(inner);
        outer.name = textLayer.name;
        try { outer.label = textLayer.label; } catch (labelError) {}
        try { outer.collapseTransformation = true; } catch (collapseError) {}
        florituraLiftAttributes(textLayer, outer);
        var innerText = florituraFindNamedLayer(inner, textLayer.name, true);
        if (!innerText) throw new Error("No pude meter el texto en la composición.");
        florituraResetLifted(innerText);
        florituraStripPieces(inner, innerText);
        if (above) outer.moveAfter(above);
        else outer.moveToBeginning();
        for (i = moving.length - 1; i >= 0; i--) moving[i].remove();
        return { comp: inner, layer: innerText, outer: outer };
    } catch (wrapError) {
        if (outer) { try { outer.remove(); } catch (removeOuter) {} }
        try { inner.remove(); } catch (removeInner) {}
        throw wrapError;
    }
}

function florituraRememberLocals(layers) {
    var notes = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        var position = layer.transform.position.value;
        notes.push({
            name: layer.name,
            text: layer instanceof TextLayer,
            parentName: layer.parent ? layer.parent.name : "",
            x: position[0],
            y: position[1]
        });
    }
    return notes;
}

function florituraReparentCopies(comp, notes) {
    for (var i = 0; i < notes.length; i++) {
        var note = notes[i];
        if (!note.parentName) continue;
        var copy = florituraFindNamedLayer(comp, note.name, note.text);
        var parentCopy = florituraFindNamedLayer(comp, note.parentName, true);
        if (!copy || !parentCopy || copy === parentCopy) continue;
        copy.parent = parentCopy;
        florituraSetPosition(copy, note.x, note.y);
    }
}

function florituraMovingLayers(comp, textLayer) {
    var layers = [];
    var meta = florituraParseMeta(textLayer.comment);
    if (meta) {
        var group = florituraGroup(comp, meta.groupId);
        florituraPushLayer(layers, group.original);
        florituraPushLayer(layers, group.before);
        florituraPushLayer(layers, group.after);
        florituraPushLayer(layers, group.shape);
    }
    if (!layers.length) layers.push(textLayer);
    return layers;
}

function florituraPushLayer(layers, layer) {
    if (!layer) return;
    for (var i = 0; i < layers.length; i++) if (layers[i] === layer) return;
    layers.push(layer);
}

function florituraSortByIndex(layers, descending) {
    var list = [];
    var i;
    for (i = 0; i < layers.length; i++) list.push(layers[i]);
    for (var a = 0; a < list.length; a++) {
        for (var b = a + 1; b < list.length; b++) {
            var swap = descending ? list[a].index < list[b].index : list[a].index > list[b].index;
            if (swap) {
                var tmp = list[a];
                list[a] = list[b];
                list[b] = tmp;
            }
        }
    }
    return list;
}

function florituraFindNamedLayer(comp, name, preferText) {
    var fallback = null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.name !== name) continue;
        if (preferText && (layer instanceof TextLayer)) return layer;
        if (!fallback) fallback = layer;
    }
    return fallback;
}

function florituraLiftAttributes(from, to) {
    try {
        if (from.parent && from.parent.containingComp === to.containingComp) to.parent = from.parent;
    } catch (parentError) {}
    try { to.threeDLayer = from.threeDLayer; } catch (threeError) {}
    florituraCopyLook(from, to);
    try { to.shy = from.shy; } catch (shyError) {}
    try { to.stretch = from.stretch; } catch (stretchError) {}
    try { to.startTime = from.startTime; } catch (startError) {}
    try {
        to.inPoint = from.inPoint;
        to.outPoint = from.outPoint;
    } catch (trimError) {}
    florituraMoveProperty(from.transform.anchorPoint, to.transform.anchorPoint);
    florituraMovePosition(from, to);
    florituraMoveProperty(from.transform.scale, to.transform.scale);
    try { florituraMoveProperty(from.transform.rotation, to.transform.rotation); } catch (rotationError) {}
    if (from.threeDLayer) {
        var axes = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z", "ADBE Orientation"];
        for (var i = 0; i < axes.length; i++) {
            try {
                var sourceProp = from.transform.property(axes[i]);
                var destProp = to.transform.property(axes[i]);
                if (sourceProp && destProp) florituraMoveProperty(sourceProp, destProp);
            } catch (axisError) {}
        }
    }
    florituraMoveProperty(from.transform.opacity, to.transform.opacity);
    florituraMoveEffects(from, to);
    try {
        if (from.trackMatteLayer && from.trackMatteLayer.containingComp === to.containingComp) to.trackMatteLayer = from.trackMatteLayer;
    } catch (matteError) {}
}

function florituraMovePosition(from, to) {
    var source = from.transform.position;
    try {
        if (source.dimensionsSeparated) {
            to.transform.position.dimensionsSeparated = true;
            florituraMoveProperty(from.transform.xPosition, to.transform.xPosition);
            florituraMoveProperty(from.transform.yPosition, to.transform.yPosition);
            if (from.threeDLayer) florituraMoveProperty(from.transform.zPosition, to.transform.zPosition);
            return;
        }
    } catch (separateError) {}
    florituraMoveProperty(source, to.transform.position);
}

function florituraMoveProperty(src, dst) {
    try { if (dst.expression) dst.expression = ""; } catch (clearExpression) {}
    try { while (dst.numKeys > 0) dst.removeKey(1); } catch (clearKeys) {}
    var expression = "";
    try { expression = src.expression || ""; } catch (readExpression) {}
    if (src.numKeys && src.numKeys > 0) {
        for (var k = 1; k <= src.numKeys; k++) {
            dst.setValueAtTime(src.keyTime(k), src.keyValue(k));
            try { dst.setInterpolationTypeAtKey(k, src.keyInInterpolationType(k), src.keyOutInterpolationType(k)); } catch (interpError) {}
            try { dst.setTemporalEaseAtKey(k, src.keyInTemporalEase(k), src.keyOutTemporalEase(k)); } catch (easeError) {}
            try { dst.setSpatialTangentsAtKey(k, src.keyInSpatialTangent(k), src.keyOutSpatialTangent(k)); } catch (spatialError) {}
        }
    } else {
        try { dst.setValue(src.value); } catch (valueError) {}
    }
    if (expression) {
        try { dst.expression = expression; } catch (setExpression) {}
    }
}

function florituraMoveEffects(from, to) {
    var src = from.property("ADBE Effect Parade");
    var dst = to.property("ADBE Effect Parade");
    if (!src || !dst) return;
    while (dst.numProperties > 0) dst.property(1).remove();
    for (var i = 1; i <= src.numProperties; i++) {
        var effect = src.property(i);
        var copy = null;
        try { copy = dst.addProperty(effect.matchName); } catch (addError) { continue; }
        try { copy.name = effect.name; } catch (nameError) {}
        try { copy.enabled = effect.enabled; } catch (enabledError) {}
        florituraCopyEffectTree(effect, copy);
    }
}

function florituraCopyEffectTree(src, dst) {
    var count = 0;
    try { count = src.numProperties; } catch (countError) { return; }
    for (var i = 1; i <= count; i++) {
        var sourceProp = src.property(i);
        var destProp = null;
        try { destProp = dst.property(i); } catch (propError) {}
        if (!sourceProp || !destProp) continue;
        var isValue = false;
        try { isValue = sourceProp.propertyType === PropertyType.PROPERTY; } catch (typeError) {}
        if (isValue) florituraMoveProperty(sourceProp, destProp);
        else florituraCopyEffectTree(sourceProp, destProp);
    }
}

function florituraResetLifted(layer) {
    try { layer.parent = null; } catch (parentError) {}
    try { if (layer.threeDLayer) layer.threeDLayer = false; } catch (threeError) {}
    try { layer.transform.position.dimensionsSeparated = false; } catch (separateError) {}
    florituraClearProperty(layer.transform.anchorPoint, florituraZeroVector(layer.transform.anchorPoint));
    florituraClearProperty(layer.transform.position, florituraZeroVector(layer.transform.position));
    florituraClearProperty(layer.transform.scale, florituraFillVector(layer.transform.scale, 100));
    try { florituraClearProperty(layer.transform.rotation, 0); } catch (rotationError) {}
    florituraClearProperty(layer.transform.opacity, 100);
    try { layer.blendingMode = BlendingMode.NORMAL; } catch (blendError) {}
    florituraRemoveEffects(layer);
}

function florituraZeroVector(prop) {
    return florituraFillVector(prop, 0);
}

function florituraFillVector(prop, fill) {
    var current = null;
    try { current = prop.value; } catch (valueError) {}
    if (!current || !current.length) return fill;
    var next = [];
    for (var i = 0; i < current.length; i++) next.push(fill);
    return next;
}

function florituraStripPieces(comp, keep) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer === keep) continue;
        florituraClearProperty(layer.transform.opacity, 100);
        florituraRemoveEffects(layer);
    }
}

function florituraRemoveEffects(layer) {
    var effects = layer.property("ADBE Effect Parade");
    try { while (effects && effects.numProperties > 0) effects.property(1).remove(); } catch (removeError) {}
}

function florituraSyncOuter(innerComp, meta) {
    var outer = florituraOuterFor(innerComp);
    if (!outer || !meta) return;
    var copy = {};
    for (var key in meta) {
        if (meta.hasOwnProperty(key)) copy[key] = meta[key];
    }
    copy.role = "comp";
    copy.compId = innerComp.id;
    outer.comment = JSON.stringify(copy);
    try { outer.collapseTransformation = true; } catch (collapseError) {}
}

function florituraSelectOuter(wrapped) {
    if (!wrapped || !wrapped.outer) return;
    var parent = wrapped.outer.containingComp;
    if (app.project.activeItem !== parent) return;
    for (var i = 1; i <= parent.numLayers; i++) parent.layer(i).selected = false;
    wrapped.outer.selected = true;
}

function florituraCreatePieces(comp, original, payload, groupId) {
    payload.groupId = groupId;
    florituraApplyStyle(original, payload);
    var layout = florituraLayout(original, payload);
    var group = { original: original, before: null, after: null, shape: null };
    florituraWritePieces(comp, group, original, payload, layout);
    return { groupId: groupId };
}

function florituraWritePieces(comp, group, original, payload, layout) {
    var groupId = payload.groupId;
    if (!groupId) {
        var existingGroup = florituraParseMeta(original.comment);
        groupId = (existingGroup && existingGroup.groupId) ? existingGroup.groupId : florituraNewId();
    }
    payload.groupId = groupId;
    var metaBase = florituraMeta(payload, original);

    if (layout.before !== "") {
        if (!group.before) {
            group.before = original.duplicate();
            group.before.moveBefore(original);
        }
        florituraPreparePiece(group.before, original, layout.before, layout.beforeX, payload);
    } else if (group.before) {
        group.before.remove();
        group.before = null;
    }

    if (!group.shape) {
        group.shape = comp.layers.addShape();
        group.shape.moveBefore(original);
    }
    group.shape.name = "Floritura · " + payload.character + (payload.feature ? " " + payload.feature : "");
    group.shape.label = 11;
    group.shape.enabled = true;
    if (original.threeDLayer) group.shape.threeDLayer = true;
    group.shape.parent = original;
    florituraSetPosition(group.shape, layout.shapeX, 0);
    florituraMatchTiming(original, group.shape);
    group.shape.motionBlur = original.motionBlur;
    florituraBuildGlyph(group.shape, payload.contours, payload.fillColor, payload.stroke);

    if (layout.after !== "") {
        if (!group.after) {
            group.after = original.duplicate();
            group.after.moveBefore(original);
        }
        florituraPreparePiece(group.after, original, layout.after, layout.afterX, payload);
    } else if (group.after) {
        group.after.remove();
        group.after = null;
    }

    if (group.before) florituraFollowSource(group.before, original);
    if (group.shape) florituraFollowSource(group.shape, original);
    if (group.after) florituraFollowSource(group.after, original);

    original.comment = florituraComment(metaBase, "original", original.comment);
    if (group.before) group.before.comment = florituraComment(metaBase, "before", "");
    if (group.after) group.after.comment = florituraComment(metaBase, "after", "");
    if (group.shape) group.shape.comment = florituraComment(metaBase, "shape", "");
    original.enabled = false;

    if (app.project.activeItem === comp) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        if (group.shape) group.shape.selected = true;
    }
}

function florituraPreparePiece(layer, original, text, x, payload) {
    layer.enabled = true;
    if (original.threeDLayer) layer.threeDLayer = true;
    layer.parent = original;
    florituraSetPosition(layer, x, 0);
    florituraMatchTiming(original, layer);
    layer.motionBlur = original.motionBlur;
    var prop = florituraTextProp(layer);
    var doc = prop.value;
    doc.text = text;
    doc.fontSize = payload.fontSize;
    doc.tracking = payload.tracking || 0;
    doc.justification = ParagraphJustification.LEFT_JUSTIFY;
    if (payload.applyFill) {
        doc.applyFill = true;
        doc.fillColor = payload.fillColor;
    }
    florituraAssignStroke(doc, payload.stroke);
    prop.setValue(doc);
    layer.name = text.length > 28 ? text.substring(0, 28) : text;
}

function florituraLayout(original, payload) {
    var doc = florituraTextDocument(original);
    var text = doc.text;
    var index = payload.charIndex;
    var before = text.substring(0, index);
    var after = text.substring(index + 1);
    var beforeWidth = before === "" ? 0 : florituraMeasure(original, before, payload);
    var afterWidth = after === "" ? 0 : florituraMeasure(original, after, payload);
    var advance = payload.advance;
    var kernBefore = before === "" ? 0 : (payload.kernBefore || 0);
    var gap = after === "" ? 0 : florituraTracking(payload);
    var kernAfter = after === "" ? 0 : (payload.kernAfter || 0);
    var cursor = beforeWidth + kernBefore;
    var shapeXFromLeft = cursor;
    cursor += advance;
    var afterXFromLeft = cursor + gap + kernAfter;
    if (after !== "") cursor = afterXFromLeft + afterWidth;
    else cursor += florituraTracking(payload);
    var width = cursor;
    var start = 0;
    if (payload.align === "center") start = -width / 2;
    else if (payload.align === "right") start = -width;
    return {
        before: before,
        after: after,
        beforeX: start,
        shapeX: start + shapeXFromLeft,
        afterX: start + afterXFromLeft
    };
}

function florituraMeasure(template, text, payload) {
    var dup = template.duplicate();
    dup.enabled = false;
    var prop = florituraTextProp(dup);
    var doc = prop.value;
    doc.text = text;
    doc.fontSize = payload.fontSize;
    doc.tracking = payload.tracking || 0;
    doc.justification = ParagraphJustification.LEFT_JUSTIFY;
    prop.setValue(doc);
    doc = prop.value;
    var locs = doc.baselineLocs;
    var width = 0;
    if (locs && locs.length >= 4) width = locs[2] - locs[0];
    dup.remove();
    return width;
}

function florituraBuildGlyph(shapeLayer, contours, fillColor, stroke) {
    var contents = shapeLayer.property("ADBE Root Vectors Group");
    while (contents.numProperties > 0) contents.property(1).remove();
    if (!contours || contours.length === 0) throw new Error("Ese glifo no tiene contorno.");
    var group = contents.addProperty("ADBE Vector Group");
    group.name = "Glifo";
    var vectors = group.property("ADBE Vectors Group");
    var c;
    for (c = 0; c < contours.length; c++) {
        var contour = contours[c];
        if (!contour.vertices || contour.vertices.length < 2) continue;
        var pathGroup = vectors.addProperty("ADBE Vector Shape - Group");
        pathGroup.name = "Contorno " + (c + 1);
        var shape = new Shape();
        shape.vertices = contour.vertices;
        shape.inTangents = contour.inTangents;
        shape.outTangents = contour.outTangents;
        shape.closed = true;
        pathGroup.property("ADBE Vector Shape").setValue(shape);
    }
    if (vectors.numProperties === 0) throw new Error("Ese glifo no tiene contorno.");
    var merge = vectors.addProperty("ADBE Vector Filter - Merge");
    merge.property("ADBE Vector Merge Type").setValue(5);
    var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(fillColor && fillColor.length >= 3 ? fillColor : [1, 1, 1]);
    if (stroke && stroke.apply && stroke.width > 0) {
        var strokeProp = vectors.addProperty("ADBE Vector Graphic - Stroke");
        strokeProp.property("ADBE Vector Stroke Color").setValue(stroke.color);
        strokeProp.property("ADBE Vector Stroke Width").setValue(stroke.width);
    }
}

function florituraApplyStyle(layer, payload) {
    var prop = florituraTextProp(layer);
    var doc = prop.value;
    doc.fontSize = payload.fontSize;
    doc.tracking = payload.tracking || 0;
    if (payload.applyFill) {
        doc.applyFill = true;
        doc.fillColor = payload.fillColor;
    }
    florituraAssignStroke(doc, payload.stroke);
    prop.setValue(doc);
}

function florituraAssignStroke(doc, stroke) {
    if (!stroke) return;
    doc.applyStroke = !!stroke.apply;
    if (stroke.apply) {
        doc.strokeColor = stroke.color;
        doc.strokeWidth = stroke.width;
    }
}

function florituraCheckText(doc, payload) {
    if (doc.boxText) throw new Error("De momento funciona con texto de punto, no con una caja de texto.");
    if (florituraIsMultiline(doc.text)) throw new Error("De momento la palabra tiene que estar en una sola línea.");
    if (payload.charIndex < 0 || payload.charIndex >= doc.text.length) {
        throw new Error("Esa letra ya no está en el texto. Vuelve a leer la capa.");
    }
    if (doc.text.charAt(payload.charIndex) !== payload.character) {
        throw new Error("El texto de la capa ha cambiado. Vuelve a leer la selección.");
    }
}

function florituraRequireTextLayer(comp, payload) {
    var layer = comp.layer(payload.layerIndex);
    if (!layer || !(layer instanceof TextLayer) || layer.name !== payload.layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var candidate = comp.layer(i);
            if (candidate instanceof TextLayer && candidate.name === payload.layerName) return candidate;
        }
        throw new Error("No encuentro la capa de texto. Vuelve a leer la selección.");
    }
    return layer;
}

function florituraGroup(comp, groupId) {
    var found = { original: null, before: null, after: null, shape: null };
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        var meta = florituraParseMeta(layer.comment);
        if (meta && meta.groupId === groupId && found.hasOwnProperty(meta.role)) found[meta.role] = layer;
    }
    return found;
}

function florituraFindMeta(layer) {
    var current = layer;
    var guard = 0;
    while (current && guard < 8) {
        var meta = florituraParseMeta(current.comment);
        if (meta) return { layer: current, meta: meta };
        current = current.parent;
        guard++;
    }
    return null;
}

function florituraMeta(payload, original) {
    var previous = "";
    var existing = florituraParseMeta(original.comment);
    if (existing && existing.previousComment) previous = existing.previousComment;
    else if (!existing) previous = original.comment || "";
    var wasEnabled = true;
    if (existing && existing.wasEnabled !== undefined) wasEnabled = existing.wasEnabled;
    else wasEnabled = original.enabled !== false;
    return {
        floritura: 1,
        groupId: payload.groupId,
        charIndex: payload.charIndex,
        character: payload.character,
        feature: payload.feature || "",
        glyphName: payload.glyphName || "",
        glyphIndex: payload.glyphIndex || 0,
        fontPath: payload.fontPath || "",
        fontPsName: payload.fontPsName || "",
        wasEnabled: wasEnabled,
        previousComment: previous
    };
}

function florituraComment(meta, role, currentComment) {
    var copy = {};
    for (var key in meta) {
        if (meta.hasOwnProperty(key)) copy[key] = meta[key];
    }
    copy.role = role;
    if (role === "original") {
        var existing = florituraParseMeta(currentComment);
        if (!existing && currentComment) copy.previousComment = currentComment;
    }
    return JSON.stringify(copy);
}

function florituraParseMeta(comment) {
    if (!comment || comment.charAt(0) !== "{") return null;
    try {
        var parsed = JSON.parse(comment);
        if (parsed && parsed.floritura === 1) return parsed;
    } catch (err) {}
    return null;
}

function florituraTextProp(layer) {
    var props = layer.property("ADBE Text Properties");
    if (!props) throw new Error("La capa no tiene texto.");
    return props.property("ADBE Text Document");
}

function florituraTextDocument(layer) {
    return florituraTextProp(layer).value;
}

function florituraAlign(doc) {
    var value = doc.justification;
    if (value === ParagraphJustification.CENTER_JUSTIFY || value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER) return "center";
    if (value === ParagraphJustification.RIGHT_JUSTIFY || value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT) return "right";
    return "left";
}

function florituraFill(doc) {
    try {
        if (!doc.applyFill || !doc.fillColor) return [1, 1, 1];
        return [doc.fillColor[0], doc.fillColor[1], doc.fillColor[2]];
    } catch (noFill) {
        return [1, 1, 1];
    }
}

function florituraStroke(doc) {
    var stroke = { apply: false, color: [0, 0, 0], width: 0, overFill: false };
    try {
        if (!doc.applyStroke) return stroke;
        stroke.apply = true;
        stroke.color = [doc.strokeColor[0], doc.strokeColor[1], doc.strokeColor[2]];
        stroke.width = doc.strokeWidth || 0;
        stroke.overFill = !!doc.strokeOverFill;
    } catch (noStroke) {}
    return stroke;
}

function florituraIsMultiline(text) {
    return text.indexOf("\r") >= 0 || text.indexOf("\n") >= 0;
}

function florituraTracking(payload) {
    return (payload.tracking || 0) / 1000 * payload.fontSize;
}

function florituraFollowSource(child, original) {
    if (child.parent !== original) child.parent = original;
    florituraResetLocalTransform(child);
    florituraLinkOpacity(child, original);
    florituraMirrorEffects(original, child);
    florituraCopyLook(original, child);
    try {
        if (original.trackMatteLayer && original.trackMatteLayer !== child) child.trackMatteLayer = original.trackMatteLayer;
    } catch (matteError) {}
}

function florituraLinkOpacity(child, original) {
    var prop = child.transform.opacity;
    var expression = "var layer = parent; var value = layer.transform.opacity; while (layer.hasParent) { layer = layer.parent; value = value * layer.transform.opacity / 100; } value;";
    if (florituraTryExpression(prop, expression)) {
        try { while (prop.numKeys > 0) prop.removeKey(1); } catch (clearError) {}
    } else {
        florituraCopyPropertyValue(original.transform.opacity, prop);
    }
}

function florituraMirrorEffects(from, to) {
    var src = from.property("ADBE Effect Parade");
    var dst = to.property("ADBE Effect Parade");
    if (!src || !dst) return;
    while (dst.numProperties > 0) dst.property(1).remove();
    for (var i = 1; i <= src.numProperties; i++) {
        var effect = src.property(i);
        var copy = null;
        try { copy = dst.addProperty(effect.matchName); } catch (addError) { continue; }
        try { copy.name = effect.name; } catch (nameError) {}
        try { copy.enabled = effect.enabled; } catch (enabledError) {}
        florituraLinkEffectProps(effect, copy, i);
    }
}

function florituraLinkEffectProps(src, dst, effectIndex) {
    var count = 0;
    try { count = src.numProperties; } catch (countError) { return; }
    for (var i = 1; i <= count; i++) {
        var sourceProp = src.property(i);
        var destProp = null;
        try { destProp = dst.property(i); } catch (propError) {}
        if (!sourceProp || !destProp) continue;
        var isValue = false;
        try { isValue = sourceProp.propertyType === PropertyType.PROPERTY; } catch (typeError) {}
        if (!isValue) {
            florituraCopyPropertyGroup(sourceProp, destProp);
            continue;
        }
        if (!florituraTryExpression(destProp, "parent.effect(" + effectIndex + ")(" + i + ")")) {
            florituraCopyPropertyValue(sourceProp, destProp);
        }
    }
}

function florituraCopyPropertyGroup(src, dst) {
    var count = 0;
    try { count = src.numProperties; } catch (countError) { return; }
    for (var i = 1; i <= count; i++) {
        var sourceProp = src.property(i);
        var destProp = null;
        try { destProp = dst.property(i); } catch (propError) {}
        if (!sourceProp || !destProp) continue;
        var isValue = false;
        try { isValue = sourceProp.propertyType === PropertyType.PROPERTY; } catch (typeError) {}
        if (isValue) florituraCopyPropertyValue(sourceProp, destProp);
        else florituraCopyPropertyGroup(sourceProp, destProp);
    }
}

function florituraCopyPropertyValue(src, dst) {
    try { if (dst.expression) dst.expression = ""; } catch (expressionError) {}
    try { while (dst.numKeys > 0) dst.removeKey(1); } catch (clearError) {}
    try {
        if (src.numKeys && src.numKeys > 0) {
            for (var k = 1; k <= src.numKeys; k++) {
                dst.setValueAtTime(src.keyTime(k), src.keyValue(k));
                try { dst.setInterpolationTypeAtKey(k, src.keyInInterpolationType(k), src.keyOutInterpolationType(k)); } catch (interpError) {}
            }
        } else {
            dst.setValue(src.value);
        }
    } catch (valueError) {}
}

function florituraTryExpression(prop, expression) {
    try {
        prop.expression = expression;
        var error = "";
        try { error = prop.expressionError || ""; } catch (readError) {}
        if (error) {
            try { prop.expression = ""; } catch (clearError) {}
            return false;
        }
        return true;
    } catch (setError) {
        return false;
    }
}

function florituraResetLocalTransform(layer) {
    var scale = layer.transform.scale.value;
    florituraClearProperty(layer.transform.scale, scale.length > 2 ? [100, 100, 100] : [100, 100]);
    try { florituraClearProperty(layer.transform.rotation, 0); } catch (rotationError) {}
    var axes = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
    for (var i = 0; i < axes.length; i++) {
        try {
            var axis = layer.transform.property(axes[i]);
            if (axis) florituraClearProperty(axis, 0);
        } catch (axisError) {}
    }
    try {
        var orientation = layer.transform.property("ADBE Orientation");
        if (orientation) florituraClearProperty(orientation, [0, 0, 0]);
    } catch (orientationError) {}
}

function florituraClearProperty(prop, value) {
    try { if (prop.expression) prop.expression = ""; } catch (expressionError) {}
    try { while (prop.numKeys > 0) prop.removeKey(1); } catch (clearError) {}
    try { prop.setValue(value); } catch (valueError) {}
}

function florituraCopyLook(from, to) {
    to.motionBlur = from.motionBlur;
    try { to.blendingMode = from.blendingMode; } catch (blendError) {}
    try { to.frameBlendingType = from.frameBlendingType; } catch (frameError) {}
    try { to.quality = from.quality; } catch (qualityError) {}
    try { to.samplingQuality = from.samplingQuality; } catch (samplingError) {}
}

function florituraRestoreSource(layer, payload) {
    var meta = florituraParseMeta(layer.comment);
    var previous = payload.previousComment || "";
    if (meta && meta.previousComment) previous = meta.previousComment;
    layer.comment = previous;
    layer.enabled = !meta || meta.wasEnabled !== false;
    var opacity = layer.transform.opacity;
    try {
        if ((!opacity.numKeys || opacity.numKeys === 0) && !opacity.expression && opacity.value === 0) opacity.setValue(100);
    } catch (opacityError) {}
}

function florituraSetPosition(layer, x, y) {
    var prop = layer.transform.position;
    florituraClearProperty(prop, prop.value.length > 2 ? [x, y, 0] : [x, y]);
}

function florituraMatchTiming(src, dest) {
    dest.startTime = src.startTime;
    dest.inPoint = src.inPoint;
    dest.outPoint = src.outPoint;
}

function florituraReadPayload(path) {
    var file = new File(path);
    if (!file.exists) throw new Error("No encuentro los datos del panel.");
    file.encoding = "UTF-8";
    file.open("r");
    var text = file.read();
    file.close();
    return JSON.parse(text);
}

function florituraJson(value) {
    return JSON.stringify(value);
}

function florituraNewId() {
    return "fl-" + (new Date().getTime());
}
