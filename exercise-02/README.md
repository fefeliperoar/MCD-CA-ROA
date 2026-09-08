# Campo de Datos · Universidad de Chile — Ejercicio 02

Computación Avanzada · Magíster en Ciencias del Diseño · Universidad Adolfo Ibáñez

## Criterio de éxito

> Quiero hacer visible **toda la temporada de Universidad de Chile en el Campeonato Nacional 2026**. Utilizo **el resultado de cada partido, la diferencia de goles y la condición de local/visitante** como datos; los transformo mediante **posición cronológica, altura y color** para representar **cómo se ve, de un vistazo, el estado de forma del equipo a lo largo de todo el torneo — y permitir entrar al detalle de cualquier partido puntual.**

## Pregunta

¿Cómo se ve el rendimiento completo de la U en el campeonato — quién ganó, con qué margen, jugando de local o de visitante — y qué pasó dentro de un partido específico (goles por minuto, tarjetas, formación)?

## Fuente

[TheSportsDB](https://www.thesportsdb.com/api.php) — API pública, JSON, solicitudes GET, sin token (usa la key de prueba compartida `3` del propio proveedor).

El proyecto encadena cuatro llamadas, cada una con su propio nivel de tolerancia al fallo:

1. `searchteams.php?t=<nombre>` resuelve el `idTeam` de Universidad de Chile (prueba varias formas del nombre, porque no todas las fuentes usan la misma ortografía). De aquí también se obtiene el `idLeague`.
2. `eventsseason.php?id=<idLeague>&s=<temporada>` trae el calendario **completo** de la liga para la temporada — no solo los últimos resultados de un equipo — y se filtra localmente por los partidos donde participa Universidad de Chile. Como no sabemos de antemano si la temporada se identifica como `"2026"` o `"2025-2026"`, se prueban varias variantes hasta encontrar una con partidos.
3. `lookuptable.php?l=<idLeague>&s=<temporada>` ubica al equipo en la tabla de posiciones vigente (mejor esfuerzo: si falla, ese panel simplemente se oculta sin romper el resto de la app).
4. `lookupevent.php?id=<idEvent>` — **bajo demanda**, solo cuando el usuario hace click en un partido — trae el detalle: formación, goles por minuto, tarjetas amarillas y rojas, alineación. No se pide para los 30 partidos por adelantado (evita saturar una API gratuita compartida); se pide uno a la vez, cuando realmente interesa "entrar" en ese partido.

Datos útiles del feed: `strHomeTeam` / `strAwayTeam`, `idHomeTeam` / `idAwayTeam`, `intHomeScore` / `intAwayScore`, `dateEvent`, `strLeague` (calendario); `strHomeFormation`, `strHomeGoalDetails`, `strHomeYellowCards`, `strHomeRedCards`, `strHomeLineup*` y sus equivalentes `Away` (detalle de partido).

**Nota honesta sobre cobertura de datos:** TheSportsDB es una base comunitaria; su nivel de detalle depende de cuánto haya documentado la comunidad cada liga. Es muy probable que el calendario y los resultados (paso 2) estén completos, pero que el detalle fino (paso 4: goles por minuto, tarjetas, alineaciones) esté incompleto o vacío para varios partidos de la Primera División chilena. Por eso el inspector siempre maneja tres estados — cargando / con datos / "sin datos disponibles" — en vez de asumir que el detalle siempre existe.

## Dataset local de respaldo

```text
assets/data/respaldo.json
```

Contiene una temporada **sintética** completa: 28 partidos jugados + 2 pendientes de Universidad de Chile (rivales, marcadores, fechas, formaciones, goles por minuto y tarjetas, todo inventado). Se activa automáticamente si la API no responde, cambia de forma o el equipo no se logra resolver. No representa resultados reales — y por eso el detalle usa números de camiseta (`#7`, `#10`) en vez de nombres de jugadores, para no atribuir eventos ficticios a personas reales.

## Arquitectura conceptual

```text
FUENTE (TheSportsDB)
  ↓
FETCH (searchteams → eventsseason → lookuptable → lookupevent bajo demanda)
  ↓
JSON
  ↓
SELECCIONAR + COMBINAR (combinarResultados / construirProximos)
  ↓
REGLAS DE REPRESENTACIÓN
  ↓
GEOMETRÍA (Three.js)
```

## Variables utilizadas

- Resultado del partido (victoria / empate / derrota)
- Diferencia de goles
- Condición: local o visitante
- Goles a favor
- Fecha / orden cronológico (jornada)
- Rival y competencia (inspector)
- Detalle bajo demanda: formación, goleadores por minuto, tarjetas amarillas/rojas, alineación (no mapeados geométricamente — son texto, no geometría, y aparecen solo al hacer click)

## Reglas de representación

### 1 — Orden cronológico → posición X

Los partidos se ordenan por fecha y se distribuyen a lo largo del eje X con separación uniforme (usamos el índice, no la fecha real, para que la línea de tiempo sea legible aunque haya semanas sin partidos de por medio). La separación se ajusta automáticamente según cuántos partidos hay en pantalla, para que una temporada completa (~28-30 partidos) siga siendo navegable.

### 2 — Local / visitante → posición Z

Cada partido se ubica en uno de dos carriles paralelos según si Universidad de Chile jugó de local o de visitante.

### 3 — Diferencia de goles → altura total

El contenedor de cada módulo crece con el valor absoluto de la diferencia de goles. Un 0-0 sigue siendo visible (altura mínima); un 4-1 se nota de inmediato.

### 4 — Resultado → color del volumen interior

Verde (victoria), gris (empate) o rojo (derrota) — una paleta semántica que se mantiene legible incluso dentro de una escena de identidad azul (ver "Estética" más abajo).

### 5 — Goles a favor → volumen interior

El volumen interior de cada módulo se llena en proporción a los goles anotados, respecto de un techo de referencia (5 goles), igual que "bicicletas disponibles" llenaba el contenedor de capacidad en LAB03.

## Variación / actualización / interacción

- **Polling responsable**: la app vuelve a consultar la API cada 5 minutos (no cada 15 segundos como un feed de movilidad — los resultados de fútbol no cambian segundo a segundo). Contador visible + botón "Actualizar ahora".
- **Selección**: modo de distribución cronológico vs. agrupado por resultado (tres carriles: victorias / empates / derrotas), para comparar en vez de solo recorrer el tiempo.
- **Controles**: escala vertical y cantidad de partidos mostrados (por defecto, todos los disponibles).
- **Profundización (drill-down)**: click en un módulo → inspector con datos base (rival, marcador, condición, fecha) y, bajo demanda, el detalle del partido (formación, goles por minuto, tarjetas, alineación).
- **Próximos partidos**: si la temporada tiene fixtures pendientes, aparecen listados aparte (no se mapean geométricamente — no tienen resultado que representar todavía).

## Estética

La paleta y la tipografía se extrajeron directamente del sitio oficial del club, [udechile.cl](https://www.udechile.cl/) (inspeccionando estilos computados, no a ojo):

- Azul institucional `#003087` (barra de navegación del sitio) y azul institucional oscuro `#00266e` (header) — usados en el panel de control, el fondo de la escena y la grilla 3D.
- Rojo institucional `#d91c21` (botones de llamado a la acción del sitio) — usado como color de acento principal de la interfaz: botón "Actualizar ahora", el toggle segmentado de distribución, la línea bajo el título.
- Tipografía **Khand** (Google Fonts), la misma familia condensada que usa udechile.cl en todo su sitio.
- Radios de borde: 6px en botones y 999px (píldora) en el selector de distribución, replicando los mismos valores que el sitio usa en sus propios botones y en su selector Masculino/Femenino.

Deliberadamente **no** se usó esta paleta para codificar resultado: victoria/empate/derrota mantienen los colores semánticos universales (verde/gris/rojo) para que la lectura del campo de datos no dependa de conocer los colores del club — la identidad visual vive en el entorno y en los controles, no en la variable que se está representando.

## Cómo ejecutarlo

Usa VS Code + Live Server (no requiere build ni instalación de dependencias: Three.js se carga desde CDN vía import map).

1. Abre esta carpeta en VS Code.
2. Click derecho sobre `index.html`.
3. `Open with Live Server`.
4. Abre Developer Tools → Console si la escena no carga o si algo se ve distinto a lo esperado, para revisar qué devolvió la API en vivo.

## Publicación

Esta carpeta está pensada para copiarse tal cual como `/exercise-02/` dentro del repositorio del curso y publicarse con GitHub Pages.

## Archivos

```text
exercise-02/
├── index.html
├── styles.css
├── main.js
├── README.md
└── assets/
    └── data/
        └── respaldo.json
```
