# Crecimiento diferencial

Un fork simplificado y con interfaz limpia de [ekimroyrp/260308_DifferentialGrowth](https://github.com/ekimroyrp/260308_DifferentialGrowth): un simulador 3D interactivo de crecimiento diferencial en Three.js con remallado adaptativo, navegación por línea de tiempo y deshacer/rehacer historial. Usa una interfaz minimalista con fondo negro y el panel de control anclado a la izquierda.

En comparación con el repositorio original, esta versión:
- Usa una interfaz limpia, minimalista y con fondo negro, con el panel de control anclado a la izquierda.
- Limita la forma base a `Torus`, `Sphere` y `Cylinder`.
- Mantiene solo los deslizadores de escala (`Scale X/Y/Z`) en el panel Shape y elimina los controles de rotación.
- Elimina por completo la función Mask (sin pintura de máscara, controles de pincel ni crecimiento impulsado por máscara).
- Limita la exportación únicamente a `Export Screenshot` (PNG), sin exportación OBJ/GLB.
- Mantiene los paneles de Simulation, Growth y Material igual que en el original.

## Características
- Simulación en tiempo real de crecimiento diferencial sobre mallas triangulares con comportamiento adaptativo de bucles (split -> grow/repulse -> relax).
- División de aristas y remallado adaptativo con límite máximo de vértices para soportar un mayor detalle en la superficie.
- Biblioteca de formas base: `Torus`, `Sphere`, `Cylinder`.
- Controles de configuración de la forma: `Start Subdivision`, `Scale X/Y/Z`, `Reset Subdivision`, `Reset Scale`.
- Controles de simulación: `Start/Pause`, `Reset`, `Simulation Rate` y navegación por `Simulation Timeline` (al reanudar, continúa desde el paso seleccionado).
- Historial global de edición con hasta 100 estados de deshacer y 100 de rehacer en deslizadores, interruptores, menús desplegables y botones de acción.
- Controles de material: `Gradient Type` (`Displacement` o `Curvature`), colores del degradado, `Gradient Contrast`, `Gradient Bias`, `Gradient Blur`, `Fresnel`, `Specular` y `Bloom`.
- `Export Screenshot` (captura PNG del viewport actual).
- Interfaz arrastrable/plegable con secciones contraíbles y controles desplegables con estilo personalizado.
- Pipeline de postprocesado con bloom y FXAA.

## Primeros pasos
1. Instala las dependencias:
   - `npm install`
2. Ejecuta el servidor de desarrollo:
   - `npm run dev`
3. Compila el paquete de producción:
   - `npm run build`
4. Vista previa local del build de producción:
   - `npm run preview`
5. Ejecuta las pruebas:
   - `npm test`

## Controles
- Cámara:
  - `Wheel` = Zoom
  - `MMB` = Pan
  - `RMB` = Orbit
- Simulación:
  - `Start` inicia la simulación
  - `Pause` detiene las actualizaciones de la simulación y habilita la navegación por la línea de tiempo
  - `Reset` reconstruye la forma actual y reinicia el historial de la línea de tiempo al paso 0
  - `Simulation Timeline` permite recorrer los pasos grabados mientras está en pausa; al presionar `Start`, continúa desde el paso seleccionado
  - `Ctrl + Z` = Deshacer (hasta 100 pasos), `Ctrl + Y` o `Ctrl + Shift + Z` = Rehacer (hasta 100 pasos)
- Forma:
  - Elige `Torus`, `Sphere` o `Cylinder`, y configura `Start Subdivision` / `Scale X/Y/Z` antes o entre ejecuciones
  - `Show Mesh` activa/desactiva la visibilidad del malla sombreada, `Show Wireframe` activa la superposición de alambre
- Exportación:
  - `Export Screenshot` descarga una captura PNG del viewport actual

## Despliegue
- **Vista previa local de producción:** `npm install`, luego `npm run build` seguido de `npm run preview` para inspeccionar el bundle compilado.
- **Publicar en GitHub Pages:** desde una rama `main` limpia, ejecuta `npm run build -- --base=./`. Cambia (o crea) la rama `gh-pages` en un worktree/clone separado, copia todo lo que haya dentro de `dist/` junto con un marcador `.nojekyll` en la raíz (y mantén el diseño mínimo de despliegue como `assets/`, `env/` e `index.html`), haz commit con un mensaje descriptivo, `git push origin gh-pages`, y luego vuelve a `main`.

## Créditos
Basado en [ekimroyrp/260308_DifferentialGrowth](https://github.com/ekimroyrp/260308_DifferentialGrowth).
