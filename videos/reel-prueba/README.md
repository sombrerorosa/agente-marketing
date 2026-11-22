# Reel de prueba (Remotion)

Reel vertical de 12,4 s (1080x1920, 30 fps) en 4 escenas, hecho con Remotion.

- `src/Root.tsx`: registra la composición `ReelPrueba`.
- `src/Reel.tsx`: el orden de las escenas y las transiciones.
- `src/Scenes.tsx`: el texto y el diseño de cada escena.
- `src/fonts.ts`: colores y fuentes (Bricolage Grotesque e Inter, en `public/fonts`, licencia OFL).

## Usarlo

```bash
npm install
npm run dev                                  # Remotion Studio: vista previa y edición
npx remotion render ReelPrueba out/reel-prueba.mp4
```

En las sesiones de Claude Code en la nube, Remotion no puede bajar su propio Chrome; agregá
`--browser-executable=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
al render.

Remotion es gratis para personas y empresas de hasta 3 empleados.
