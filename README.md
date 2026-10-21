# Floritura

Panel de After Effects para ver las variantes OpenType de una letra (swashes, sets, alternativas) y colocar la que elijas en la composición.

La letra elegida entra como trazado, atada a la fuente y al cuerpo. Desde el panel se cambia la variante, la letra o el tamaño. El resto de la palabra sigue siendo texto. La fuente original no se modifica.

![Floritura colocando la E de El Armario del Mundo](docs/demo.gif)

## Abrirlo

After Effects 2026 carga este tipo de paneles por CEP. La primera vez hay que reiniciar el programa.

1. Clona este repositorio.
2. Enlázalo y activa la depuración de CEP:

```
ln -sfn "$PWD" "$HOME/Library/Application Support/Adobe/CEP/extensions/com.alejito.floritura"
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

3. Reinicia After Effects.
4. Ventana → Extensiones (heredado) → Floritura. En algunas versiones el menú se llama solo Extensiones.

## Usarlo

1. Selecciona una capa de texto de punto, de una sola línea.
2. Pulsa **Leer capa**. Si la fuente no aparece sola, pulsa **Elegir fuente…** y señala el `.otf` o `.ttf`.
3. Pulsa la letra y elige la variante. La palabra de abajo enseña cómo queda.
4. **Colocar en la composición.** La palabra pasa a una composición propia, del mismo tamaño. Por fuera queda una sola capa con el fundido, los efectos y el movimiento. Dentro están el glifo (capa naranja) y el resto del texto.
5. Para cambiarla, selecciona esa capa y pulsa **Actualizar letra**. **Volver a texto** quita el glifo y deja la palabra dentro de su composición.

## Límites de esta versión

- Texto de punto y una sola línea.
- Las fuentes de Adobe Fonts a veces no están como archivo legible. Hace falta el `.otf` o `.ttf`.
- El tamaño, el color y el tracking salen de la capa en el momento de colocar o actualizar. El fundido y los efectos se quedan en la capa de fuera. Cambiar el cuerpo se hace desde el panel.
