import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ======================================================
// 01 — CONFIGURACIÓN
// ======================================================
// Fuente: TheSportsDB (API pública, JSON, solicitudes GET, sin token —
// usa la key de prueba compartida "3" del propio proveedor).
// https://www.thesportsdb.com/api.php
//
// Seguimos a un único equipo, Universidad de Chile, durante TODA la
// temporada del Campeonato Nacional: no solo sus últimos resultados,
// sino el calendario completo de la liga (eventsseason.php) filtrado
// por este equipo.

const BASE = "https://www.thesportsdb.com/api/v1/json/3/";

// El nombre exacto que expone la API puede variar (con o sin guión bajo),
// así que probamos varias variantes hasta encontrar el equipo correcto.
const CANDIDATOS_EQUIPO = [
  "Universidad de Chile",
  "Universidad_de_Chile",
  "CD Universidad de Chile",
  "U de Chile",
];

function temporadasCandidatas() {
  // La API pide un string de temporada ("s="). No sabemos de antemano si
  // esta liga usa años simples ("2026") o cruzados ("2025-2026"), así que
  // probamos varias formas en torno al año actual.
  const anio = new Date().getFullYear();
  return [`${anio}`, `${anio - 1}-${anio}`, `${anio}-${anio + 1}`, `${anio - 1}`];
}

const MINIMO_PARTIDOS_PARA_CONSIDERAR_VIVO = 8; // Si TheSportsDB devuelve
// menos partidos que esto para toda la temporada, la cobertura es demasiado
// pobre para la pregunta que queremos responder ("toda la temporada"), y
// preferimos el dataset local completo antes que un campo casi vacío.

const INTERVALO_ACTUALIZACION = 300; // segundos. Los resultados de fútbol
// no cambian segundo a segundo como un feed de bicicletas: hacer polling
// responsable aquí significa consultar cada varios minutos, no cada 15s.

const parametros = {
  modo: "cronologico",
  escalaAltura: 0.55,
  cantidad: 15,
};

let actualizacionAutomatica = true;
let segundosRestantes = INTERVALO_ACTUALIZACION;
let partidos = [];
let partidosProximos = [];
let objetosPartido = [];
let equipoId = null;
let equipoNombre = "Universidad de Chile";
let idLiga = null;
let temporadaActual = null;
let cantidadAjustadaManualmente = false;
let camaraAjustada = false;

// ======================================================
// 02 — ESCENA
// ======================================================
// Paleta tomada directamente de udechile.cl (sitio oficial del club):
// azul institucional (nav) 0x003087, azul institucional oscuro (header)
// 0x00266e, rojo institucional (botones/CTA) 0xd91c21. Se usan como color
// dominante de la escena y la interfaz. El resultado (victoria/empate/
// derrota) mantiene su propia paleta semántica (verde/gris/rojo) para no
// perder legibilidad dentro de un ambiente todo-azul — ver README.

const AZUL_CLUB = 0x003087;
const AZUL_CLUB_OSCURO = 0x00266e;
const ROJO_CLUB = 0xd91c21;

const viewport = document.querySelector("#viewport");
const escena = new THREE.Scene();
escena.background = new THREE.Color(0x02040c);

const camara = new THREE.PerspectiveCamera(
  40,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  400
);
camara.position.set(2, 26, 36);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const controlesOrbita = new OrbitControls(camara, renderer.domElement);
controlesOrbita.enableDamping = true;
controlesOrbita.target.set(0, 1.5, 0);
controlesOrbita.maxDistance = 160;

escena.add(new THREE.HemisphereLight(0xdde6ff, 0x060a18, 1.8));

const luzPrincipal = new THREE.DirectionalLight(0xeaf1ff, 2.6);
luzPrincipal.position.set(16, 26, 12);
luzPrincipal.castShadow = true;
escena.add(luzPrincipal);

const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(140, 140),
  new THREE.MeshStandardMaterial({ color: 0x040d24, roughness: 1 })
);
suelo.rotation.x = -Math.PI / 2;
suelo.position.y = -0.02;
suelo.receiveShadow = true;
escena.add(suelo);

const grilla = new THREE.GridHelper(120, 80, AZUL_CLUB, 0x0a1636);
grilla.position.y = 0.001;
escena.add(grilla);

const grupoPartidos = new THREE.Group();
escena.add(grupoPartidos);

const grupoGuias = new THREE.Group();
escena.add(grupoGuias);

// Colores de resultado: REGLA 4 (ver más abajo). Se mantienen semánticos
// (verde/gris/rojo), independientes de la paleta institucional azul.
const COLOR_VICTORIA = 0x4fd18b;
const COLOR_EMPATE = 0xc9c9c9;
const COLOR_DERROTA = 0xef5d6f;
const COLOR_CONTENEDOR = 0x0b2454; // azul institucional (udechile.cl), apagado

// ======================================================
// 03 — DATOS: FETCH + FALLBACK
// ======================================================

async function cargarDatosVivos() {
  actualizarEstadoConexion("conectando");

  try {
    if (!equipoId) {
      await resolverEquipo();
    }

    if (!equipoId || !idLiga) {
      throw new Error("No fue posible resolver equipo/liga en TheSportsDB.");
    }

    const resuelto = await resolverLigaYTemporada();

    if (!resuelto) {
      throw new Error("No se encontró una liga/temporada con partidos.");
    }

    temporadaActual = resuelto.temporada;

    const eventosEquipo = resuelto.eventos.filter((evento) => perteneceAlEquipo(evento) !== null);

    console.log(
      `eventsseason.php · temporada "${temporadaActual}": ${resuelto.eventos.length} eventos en la liga, ${eventosEquipo.length} de ${equipoNombre}.`
    );

    const jugados = combinarResultados(eventosEquipo);
    const proximos = construirProximos(eventosEquipo);

    console.log(`Partidos jugados: ${jugados.length} · Próximos: ${proximos.length}.`);

    if (jugados.length === 0) {
      throw new Error("La temporada no tiene partidos jugados todavía.");
    }

    if (jugados.length < MINIMO_PARTIDOS_PARA_CONSIDERAR_VIVO) {
      throw new Error(
        `TheSportsDB solo tiene ${jugados.length} partido(s) cargado(s) para esta liga/temporada — ` +
          `cobertura insuficiente para representar "toda la temporada". Se prefiere el respaldo local.`
      );
    }

    partidos = jugados;
    partidosProximos = proximos;

    actualizarEstadoConexion("vivo");
    document.querySelector("#fuente-label").textContent =
      "TheSportsDB · API pública";
    document.querySelector("#temporada-label").textContent = temporadaActual;
    document.querySelector("#actualizacion-label").textContent =
      new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    ajustarControlCantidad(partidos.length);
    renderProximos(partidosProximos);
    generarRepresentacion();
    cargarTabla(idLiga, temporadaActual);
  } catch (error) {
    console.warn(
      "No fue posible usar el feed vivo de TheSportsDB. Se utilizará el dataset local.",
      error
    );
    await cargarRespaldoLocal();
  }
}

async function resolverEquipo() {
  for (const candidato of CANDIDATOS_EQUIPO) {
    try {
      const respuesta = await fetch(
        `${BASE}searchteams.php?t=${encodeURIComponent(candidato)}`,
        { cache: "no-store" }
      );

      if (!respuesta.ok) continue;

      const datos = await respuesta.json();
      const equipos = datos.teams ?? [];

      const coincidencia =
        equipos.find((equipo) =>
          (equipo.strTeam || "").toLowerCase().includes("universidad de chile")
        ) ?? equipos[0];

      if (coincidencia) {
        equipoId = coincidencia.idTeam;
        equipoNombre = coincidencia.strTeam;
        idLiga = coincidencia.idLeague ?? null;
        return;
      }
    } catch (error) {
      console.warn(`searchteams.php falló para "${candidato}".`, error);
    }
  }
}

async function resolverLigaYTemporada() {
  // TheSportsDB es una base comunitaria: la liga que "searchteams.php" nos
  // asocia al equipo puede tener muy poca cobertura de partidos aunque el
  // equipo y su tabla de posiciones existan. Por eso no confiamos en un solo
  // idLeague — ampliamos la búsqueda a todas las ligas de fútbol chilenas
  // que la API conoce, y nos quedamos con la que realmente tiene partidos
  // cargados.
  const candidatosLiga = new Map(); // idLeague → nombre (solo para logging)

  if (idLiga) {
    candidatosLiga.set(idLiga, "liga asociada al equipo");
  }

  try {
    const respuesta = await fetch(`${BASE}all_leagues.php`, { cache: "no-store" });

    if (respuesta.ok) {
      const datos = await respuesta.json();
      const ligas = datos.leagues ?? [];

      ligas
        .filter(
          (liga) =>
            (liga.strSport || "").toLowerCase() === "soccer" &&
            (liga.strLeague || "").toLowerCase().includes("chile")
        )
        .slice(0, 8)
        .forEach((liga) => {
          if (!candidatosLiga.has(liga.idLeague)) {
            candidatosLiga.set(liga.idLeague, liga.strLeague);
          }
        });
    }
  } catch (error) {
    console.warn(
      "all_leagues.php falló; se continúa solo con la liga asociada al equipo.",
      error
    );
  }

  console.log(
    `Ligas candidatas: ${[...candidatosLiga.entries()]
      .map(([id, nombre]) => `${nombre} (${id})`)
      .join(" · ")}`
  );

  // Paso 1: una temporada rápida (el año en curso) por cada liga candidata,
  // solo para medir qué tan cubierta está.
  const anioActual = `${new Date().getFullYear()}`;
  let mejor = null;

  for (const [idLigaCandidata, nombreLiga] of candidatosLiga) {
    try {
      const respuesta = await fetch(
        `${BASE}eventsseason.php?id=${idLigaCandidata}&s=${anioActual}`,
        { cache: "no-store" }
      );

      if (!respuesta.ok) continue;

      const datos = await respuesta.json();
      const eventos = datos.events ?? [];

      console.log(
        `  · ${nombreLiga} (${idLigaCandidata}) · temporada ${anioActual}: ${eventos.length} eventos.`
      );

      if (!mejor || eventos.length > mejor.eventos.length) {
        mejor = { idLiga: idLigaCandidata, nombreLiga, temporada: anioActual, eventos };
      }
    } catch (error) {
      console.warn(`eventsseason.php falló para la liga ${idLigaCandidata}.`, error);
    }
  }

  if (!mejor) return null;

  // Paso 2: ya con la liga ganadora, probamos las otras variantes de
  // temporada por si alguna trae más partidos que el año calendario.
  for (const temporada of temporadasCandidatas()) {
    if (temporada === mejor.temporada) continue;

    try {
      const respuesta = await fetch(
        `${BASE}eventsseason.php?id=${mejor.idLiga}&s=${temporada}`,
        { cache: "no-store" }
      );

      if (!respuesta.ok) continue;

      const datos = await respuesta.json();
      const eventos = datos.events ?? [];

      console.log(
        `  · ${mejor.nombreLiga} (${mejor.idLiga}) · temporada ${temporada}: ${eventos.length} eventos.`
      );

      if (eventos.length > mejor.eventos.length) {
        mejor = { ...mejor, temporada, eventos };
      }
    } catch (error) {
      console.warn(`eventsseason.php falló para temporada ${temporada}.`, error);
    }
  }

  idLiga = mejor.idLiga; // se reutiliza más abajo para la tabla de posiciones.

  return { temporada: mejor.temporada, eventos: mejor.eventos };
}

// El feed de temporada (eventsseason.php) puede no traer idHomeTeam/idAwayTeam
// para ligas con menor cobertura comunitaria — solo el nombre del equipo.
// Por eso identificamos "es nuestro equipo" primero por nombre (siempre
// presente) y usamos el id como respaldo/confirmación cuando existe.
function normalizarNombre(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function coincideConEquipo(nombre) {
  if (!nombre) return false;
  const normalizado = normalizarNombre(nombre);
  return (
    normalizado === normalizarNombre(equipoNombre) ||
    normalizado.includes("universidad de chile")
  );
}

function perteneceAlEquipo(evento) {
  const esLocalPorId = evento.idHomeTeam != null && String(evento.idHomeTeam) === String(equipoId);
  const esVisitaPorId = evento.idAwayTeam != null && String(evento.idAwayTeam) === String(equipoId);
  const esLocalPorNombre = coincideConEquipo(evento.strHomeTeam);
  const esVisitaPorNombre = coincideConEquipo(evento.strAwayTeam);

  if (esLocalPorId || esLocalPorNombre) return "local";
  if (esVisitaPorId || esVisitaPorNombre) return "visita";
  return null;
}

async function cargarTabla(idLigaParam, temporada) {
  const panel = document.querySelector("#tabla-panel");

  if (!idLigaParam || !temporada) {
    panel.hidden = true;
    return;
  }

  try {
    const respuesta = await fetch(
      `${BASE}lookuptable.php?l=${idLigaParam}&s=${temporada}`,
      { cache: "no-store" }
    );

    if (!respuesta.ok) throw new Error("lookuptable.php respondió con error.");

    const datos = await respuesta.json();
    const tabla = datos.table ?? [];
    const fila = tabla.find((equipo) => equipo.idTeam === equipoId);

    if (!fila) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    document.querySelector("#tabla-posicion").textContent = `#${fila.intRank}`;
    document.querySelector("#tabla-puntos").textContent =
      `${fila.intPlayed} · ${fila.intPoints}`;
    document.querySelector("#tabla-diferencia").textContent =
      fila.intGoalDifference > 0
        ? `+${fila.intGoalDifference}`
        : `${fila.intGoalDifference}`;
  } catch (error) {
    // Best-effort: la tabla es información complementaria, no crítica.
    // Si falla, simplemente se oculta y el resto de la app sigue intacto.
    console.warn("No fue posible cargar la tabla de posiciones.", error);
    panel.hidden = true;
  }
}

async function cargarRespaldoLocal() {
  const respuesta = await fetch("./assets/data/respaldo.json");
  const datos = await respuesta.json();

  equipoNombre = datos.equipo ?? "Universidad de Chile";
  partidos = datos.partidos.map((partido) => ({ ...partido }));
  partidosProximos = (datos.proximos ?? []).map((partido) => ({ ...partido }));

  actualizarEstadoConexion("respaldo");
  document.querySelector("#fuente-label").textContent =
    "Dataset local · respaldo";
  document.querySelector("#temporada-label").textContent =
    "sintética (respaldo)";
  document.querySelector("#actualizacion-label").textContent =
    "archivo local";
  document.querySelector("#tabla-panel").hidden = true;

  ajustarControlCantidad(partidos.length);
  renderProximos(partidosProximos);
  generarRepresentacion();
}

function combinarResultados(eventos) {
  return eventos
    .filter(
      (evento) => evento.intHomeScore !== null && evento.intAwayScore !== null
    )
    .map((evento) => {
      const esLocal = perteneceAlEquipo(evento) === "local";
      const golesHome = Number(evento.intHomeScore);
      const golesAway = Number(evento.intAwayScore);

      return {
        id: evento.idEvent,
        fecha: evento.dateEvent,
        rival: esLocal ? evento.strAwayTeam : evento.strHomeTeam,
        esLocal,
        golesFavor: esLocal ? golesHome : golesAway,
        golesContra: esLocal ? golesAway : golesHome,
        competencia: evento.strLeague ?? "—",
      };
    })
    .filter((partido) => partido.rival)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function construirProximos(eventos) {
  return eventos
    .filter(
      (evento) => evento.intHomeScore === null || evento.intAwayScore === null
    )
    .map((evento) => {
      const esLocal = perteneceAlEquipo(evento) === "local";
      return {
        id: evento.idEvent,
        fecha: evento.dateEvent,
        rival: esLocal ? evento.strAwayTeam : evento.strHomeTeam,
        esLocal,
        competencia: evento.strLeague ?? "—",
      };
    })
    .filter((partido) => partido.rival)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .slice(0, 5);
}

// ======================================================
// 04 — REGLAS: INPUT → RELACIÓN → OUTPUT
// ======================================================

function calcularDiferencia(partido) {
  return partido.golesFavor - partido.golesContra;
}

function calcularResultado(partido) {
  const diferencia = calcularDiferencia(partido);
  if (diferencia > 0) return "G";
  if (diferencia < 0) return "P";
  return "E";
}

const CARRIL_Z = 2.1;

function separacionSegunCantidad(n) {
  // Con una temporada completa (hasta ~30 fechas) comprimimos el espaciado
  // para que el campo siga siendo navegable sin alejar demasiado la cámara.
  if (n > 22) return 1.6;
  if (n > 14) return 2.0;
  return 2.6;
}

function distribuirCronologico(seleccionados) {
  // REGLA 1: orden cronológico → posición X.
  // Usamos el índice, no la fecha real, para que la línea temporal sea
  // legible aunque haya semanas sin partidos de por medio.
  const separacion = separacionSegunCantidad(seleccionados.length);
  const centro = (seleccionados.length - 1) / 2;

  return seleccionados.map((partido, indice) => ({
    ...partido,
    x: (indice - centro) * separacion,
    // REGLA 2: condición local/visitante → posición Z (dos carriles).
    z: partido.esLocal ? CARRIL_Z : -CARRIL_Z,
  }));
}

function distribuirPorResultado(seleccionados) {
  // Modo alternativo: agrupa por resultado en tres carriles (Z) y ordena
  // dentro de cada carril por diferencia de gol (X). Permite comparar
  // "cuántas veces gané y por cuánto" en vez de "cuándo pasó".
  const separacion = separacionSegunCantidad(seleccionados.length);
  const carriles = { G: CARRIL_Z * 1.3, E: 0, P: -CARRIL_Z * 1.3 };

  const ordenados = [...seleccionados].sort(
    (a, b) => calcularDiferencia(b) - calcularDiferencia(a)
  );

  const totalesPorGrupo = { G: 0, E: 0, P: 0 };
  ordenados.forEach((partido) => totalesPorGrupo[calcularResultado(partido)]++);

  const centrosPorGrupo = {
    G: (totalesPorGrupo.G - 1) / 2,
    E: (totalesPorGrupo.E - 1) / 2,
    P: (totalesPorGrupo.P - 1) / 2,
  };

  const contadores = { G: 0, E: 0, P: 0 };

  return ordenados.map((partido) => {
    const resultado = calcularResultado(partido);
    const indice = contadores[resultado]++;

    return {
      ...partido,
      x: (indice - centrosPorGrupo[resultado]) * separacion,
      z: carriles[resultado],
    };
  });
}

function generarRepresentacion() {
  limpiarRepresentacion();

  const seleccion = partidos.slice(-parametros.cantidad);

  const distribuidos =
    parametros.modo === "cronologico"
      ? distribuirCronologico(seleccion)
      : distribuirPorResultado(seleccion);

  actualizarGuias(distribuidos);
  distribuidos.forEach(crearModuloPartido);

  if (!camaraAjustada && distribuidos.length > 0) {
    ajustarCamaraSegunCantidad(distribuidos.length);
    camaraAjustada = true;
  }
}

function ajustarCamaraSegunCantidad(n) {
  const distancia = Math.min(160, 30 + n * 1.15);
  camara.position.set(2, distancia * 0.72, distancia);
  camara.updateProjectionMatrix();
  controlesOrbita.update();
}

function crearModuloPartido(partido) {
  const diferencia = calcularDiferencia(partido);
  const resultado = calcularResultado(partido);

  // REGLA 3: diferencia de goles (en valor absoluto) → altura del
  // contenedor. Un empate 0-0 sigue siendo visible (altura mínima).
  const alturaTotal = Math.max(
    0.6,
    (Math.abs(diferencia) + 1) * parametros.escalaAltura
  );

  // REGLA 5: goles a favor, relativos a un techo de referencia (5 goles),
  // → volumen interior. Un 4-1 llena casi todo el contenedor; un 0-0 casi nada.
  const techoReferencia = 5;
  const fraccionInterior = Math.min(1, partido.golesFavor / techoReferencia);
  const alturaInterior = Math.max(0.12, alturaTotal * fraccionInterior);

  const ancho = 0.85;

  const grupo = new THREE.Group();
  grupo.position.set(partido.x, 0, partido.z);
  grupo.userData.partido = partido;

  const geometriaContenedor = new THREE.BoxGeometry(ancho, alturaTotal, ancho);
  const materialContenedor = new THREE.MeshStandardMaterial({
    color: COLOR_CONTENEDOR,
    roughness: 0.9,
    transparent: true,
    opacity: 0.55,
  });
  const contenedor = new THREE.Mesh(geometriaContenedor, materialContenedor);
  contenedor.position.y = alturaTotal / 2;
  contenedor.userData.partido = partido;
  grupo.add(contenedor);

  // REGLA 4: resultado (victoria/empate/derrota) → color del volumen interior.
  const colorResultado =
    resultado === "G" ? COLOR_VICTORIA : resultado === "E" ? COLOR_EMPATE : COLOR_DERROTA;

  const geometriaInterior = new THREE.BoxGeometry(
    ancho * 0.66,
    alturaInterior,
    ancho * 0.66
  );
  const materialInterior = new THREE.MeshStandardMaterial({
    color: colorResultado,
    roughness: 0.4,
    emissive: colorResultado,
    emissiveIntensity: resultado === "G" ? 0.25 : 0.05,
  });
  const interior = new THREE.Mesh(geometriaInterior, materialInterior);
  interior.position.y = alturaInterior / 2;
  interior.castShadow = true;
  interior.userData.partido = partido;
  grupo.add(interior);

  const etiqueta = crearEtiquetaFlotante(
    `${partido.rival}\n${partido.golesFavor}-${partido.golesContra}`,
    alturaTotal + 0.75
  );
  grupo.add(etiqueta);

  grupoPartidos.add(grupo);
  objetosPartido.push(contenedor, interior);
}

function limpiarRepresentacion() {
  objetosPartido = [];
  limpiarGrupo(grupoPartidos);
}

function actualizarGuias(distribuidos) {
  limpiarGrupo(grupoGuias);

  if (distribuidos.length === 0) return;

  const xs = distribuidos.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  if (parametros.modo === "cronologico") {
    grupoGuias.add(crearEtiquetaSuelo("tiempo →", minX - 1.4, -CARRIL_Z * 1.9, 30));
    grupoGuias.add(crearEtiquetaSuelo("LOCAL", maxX + 1.6, CARRIL_Z, 26));
    grupoGuias.add(crearEtiquetaSuelo("VISITANTE", maxX + 1.9, -CARRIL_Z, 26));
  } else {
    grupoGuias.add(crearEtiquetaSuelo("VICTORIAS", minX - 2.2, CARRIL_Z * 1.3, 26));
    grupoGuias.add(crearEtiquetaSuelo("EMPATES", minX - 2.2, 0, 26));
    grupoGuias.add(crearEtiquetaSuelo("DERROTAS", minX - 2.2, -CARRIL_Z * 1.3, 26));
  }
}

function limpiarGrupo(grupo) {
  while (grupo.children.length > 0) {
    const objeto = grupo.children[0];

    objeto.traverse((hijo) => {
      if (hijo.geometry) hijo.geometry.dispose();
      if (hijo.material) {
        if (hijo.material.map) hijo.material.map.dispose();
        hijo.material.dispose();
      }
    });

    grupo.remove(objeto);
  }
}

function crearEtiquetaSuelo(texto, x, z, tamanoFuente) {
  const canvas = document.createElement("canvas");
  const contexto = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 96;

  contexto.fillStyle = "rgba(180, 200, 235, 0.8)";
  contexto.font = `${tamanoFuente}px Roboto, Arial, sans-serif`;
  contexto.textAlign = "center";
  contexto.textBaseline = "middle";
  contexto.fillText(texto, canvas.width / 2, canvas.height / 2);

  const textura = new THREE.CanvasTexture(canvas);
  const etiqueta = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false })
  );
  etiqueta.position.set(x, 0.18, z);
  etiqueta.scale.set(3.6, 1.35, 1);

  return etiqueta;
}

function crearEtiquetaFlotante(texto, alturaY) {
  const canvas = document.createElement("canvas");
  const contexto = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 110;

  contexto.fillStyle = "rgba(233, 237, 245, 0.92)";
  contexto.font = "26px Roboto, Arial, sans-serif";
  contexto.textAlign = "center";

  const [linea1, linea2] = texto.split("\n");
  contexto.fillText(linea1, canvas.width / 2, 42);
  contexto.font = "22px Roboto, Arial, sans-serif";
  contexto.fillStyle = "rgba(170, 178, 194, 0.85)";
  contexto.fillText(linea2, canvas.width / 2, 76);

  const textura = new THREE.CanvasTexture(canvas);
  const etiqueta = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false })
  );
  etiqueta.position.set(0, alturaY, 0);
  etiqueta.scale.set(2.1, 0.9, 1);

  return etiqueta;
}

// ======================================================
// 05 — INTERFAZ + INSPECTOR (incluye detalle bajo demanda)
// ======================================================

const raycaster = new THREE.Raycaster();
const puntero = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();

  puntero.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  puntero.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(puntero, camara);

  const intersecciones = raycaster.intersectObjects(objetosPartido, false);

  if (intersecciones.length > 0) {
    mostrarPartido(intersecciones[0].object.userData.partido);
  }
});

async function mostrarPartido(partido) {
  document.querySelector("#partido-titulo").textContent =
    `${equipoNombre} vs ${partido.rival}`;
  document.querySelector("#m-marcador").textContent =
    `${partido.golesFavor} - ${partido.golesContra}`;
  document.querySelector("#m-condicion").textContent = partido.esLocal
    ? "Local"
    : "Visitante";
  document.querySelector("#m-competencia").textContent = partido.competencia;
  document.querySelector("#m-fecha").textContent = partido.fecha;

  // El detalle (formación, goles por minuto, tarjetas) es una segunda
  // capa de datos: no viene en el mismo feed que el resultado, así que
  // se pide bajo demanda cuando el usuario realmente quiere "entrar" en
  // un partido específico.
  if (partido.detalle) {
    renderDetalle(partido.detalle);
    return;
  }

  renderDetalle(null, "cargando");

  try {
    const detalle = await obtenerDetalleEvento(partido.id);
    renderDetalle(detalle);
  } catch (error) {
    console.warn("No fue posible obtener el detalle del partido.", error);
    renderDetalle(null, "sin-datos");
  }
}

async function obtenerDetalleEvento(idEvento) {
  const respuesta = await fetch(`${BASE}lookupevent.php?id=${idEvento}`, {
    cache: "no-store",
  });

  if (!respuesta.ok) throw new Error("lookupevent.php respondió con error.");

  const datos = await respuesta.json();
  const evento = (datos.events ?? [])[0];

  if (!evento) throw new Error("lookupevent.php no devolvió el partido.");

  return {
    formacionLocal: evento.strHomeFormation || "",
    formacionVisita: evento.strAwayFormation || "",
    golesLocal: evento.strHomeGoalDetails || "",
    golesVisita: evento.strAwayGoalDetails || "",
    amarillasLocal: evento.strHomeYellowCards || "",
    amarillasVisita: evento.strAwayYellowCards || "",
    rojasLocal: evento.strHomeRedCards || "",
    rojasVisita: evento.strAwayRedCards || "",
    alineacionLocal: combinarLineup(evento, "Home"),
    alineacionVisita: combinarLineup(evento, "Away"),
  };
}

function combinarLineup(evento, prefijo) {
  return [
    evento[`str${prefijo}LineupGoalkeeper`],
    evento[`str${prefijo}LineupDefense`],
    evento[`str${prefijo}LineupMidfield`],
    evento[`str${prefijo}LineupForward`],
  ]
    .filter(Boolean)
    .join("; ");
}

function renderDetalle(detalle, estado) {
  const contenedor = document.querySelector("#detalle-partido");

  if (estado === "cargando") {
    contenedor.innerHTML = '<p class="detalle-estado">Cargando detalle…</p>';
    return;
  }

  if (!detalle || estado === "sin-datos") {
    contenedor.innerHTML =
      '<p class="detalle-estado">Sin datos de detalle disponibles para este partido en la fuente actual.</p>';
    return;
  }

  const filas = [];

  if (detalle.formacionLocal || detalle.formacionVisita) {
    filas.push(
      filaDetalle("Formación", detalle.formacionLocal, detalle.formacionVisita)
    );
  }
  if (detalle.golesLocal || detalle.golesVisita) {
    filas.push(filaDetalle("Goles", detalle.golesLocal, detalle.golesVisita));
  }
  if (detalle.amarillasLocal || detalle.amarillasVisita) {
    filas.push(
      filaDetalle("Amarillas", detalle.amarillasLocal, detalle.amarillasVisita)
    );
  }
  if (detalle.rojasLocal || detalle.rojasVisita) {
    filas.push(filaDetalle("Rojas", detalle.rojasLocal, detalle.rojasVisita));
  }
  if (detalle.alineacionLocal || detalle.alineacionVisita) {
    filas.push(
      filaDetalle(
        "Alineación",
        formatearAlineacion(detalle.alineacionLocal),
        formatearAlineacion(detalle.alineacionVisita)
      )
    );
  }

  contenedor.innerHTML =
    filas.length > 0
      ? filas.join("")
      : '<p class="detalle-estado">Sin datos de detalle disponibles para este partido en la fuente actual.</p>';
}

function filaDetalle(etiqueta, local, visita) {
  return `<div class="detalle-row">
    <span>${escapeHtml(etiqueta)}</span>
    <div><b>L</b> ${escapeHtml(local || "—")}</div>
    <div><b>V</b> ${escapeHtml(visita || "—")}</div>
  </div>`;
}

function formatearAlineacion(valor) {
  if (Array.isArray(valor)) {
    return valor.map((numero) => `#${numero}`).join(", ");
  }
  return (valor || "").replaceAll(";", ", ");
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto);
  return div.innerHTML;
}

function renderProximos(lista) {
  const panel = document.querySelector("#proximos-panel");
  const contenedor = document.querySelector("#proximos-lista");

  if (!lista || lista.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  contenedor.innerHTML = lista
    .map(
      (partido) => `<div class="proximo-row">
        <span>${escapeHtml(partido.fecha)}</span>
        <b>${escapeHtml(partido.esLocal ? "vs" : "@")} ${escapeHtml(partido.rival)}</b>
      </div>`
    )
    .join("");
}

const botonesSegmentados = document.querySelectorAll(".segmented-option");

botonesSegmentados.forEach((boton) => {
  boton.addEventListener("click", () => {
    botonesSegmentados.forEach((otro) => {
      otro.classList.remove("active");
      otro.setAttribute("aria-selected", "false");
    });
    boton.classList.add("active");
    boton.setAttribute("aria-selected", "true");
    parametros.modo = boton.dataset.modo;
    generarRepresentacion();
  });
});

conectarSlider("escala-altura", "escala-altura-valor", "escalaAltura", 2);
conectarSlider("cantidad", "cantidad-valor", "cantidad", 0);

document.querySelector("#cantidad").addEventListener("input", () => {
  cantidadAjustadaManualmente = true;
});

function conectarSlider(idControl, idValor, parametro, decimales) {
  const control = document.querySelector(`#${idControl}`);
  const valor = document.querySelector(`#${idValor}`);

  control.addEventListener("input", (event) => {
    parametros[parametro] = Number(event.target.value);
    valor.value = parametros[parametro].toFixed(decimales);
    generarRepresentacion();
  });
}

function ajustarControlCantidad(total) {
  const control = document.querySelector("#cantidad");
  const valor = document.querySelector("#cantidad-valor");

  control.max = total;

  if (!cantidadAjustadaManualmente) {
    control.value = total;
    parametros.cantidad = total;
    valor.value = total;
  } else {
    parametros.cantidad = Math.min(parametros.cantidad, total);
    control.value = parametros.cantidad;
    valor.value = parametros.cantidad;
  }
}

document.querySelector("#actualizar").addEventListener("click", async () => {
  segundosRestantes = INTERVALO_ACTUALIZACION;
  await cargarDatosVivos();
});

document.querySelector("#pausar").addEventListener("click", (event) => {
  actualizacionAutomatica = !actualizacionAutomatica;
  event.target.textContent = actualizacionAutomatica
    ? "Pausar auto"
    : "Reanudar auto";

  document.querySelector("#cuenta-regresiva").textContent =
    actualizacionAutomatica ? formatearCuentaRegresiva(segundosRestantes) : "pausada";
});

function actualizarEstadoConexion(tipo) {
  const estado = document.querySelector("#estado-label");

  if (tipo === "vivo") {
    estado.innerHTML = '<i class="status-dot"></i> conectado';
  } else if (tipo === "respaldo") {
    estado.textContent = "respaldo local";
  } else {
    estado.textContent = "conectando…";
  }
}

function formatearCuentaRegresiva(segundos) {
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

// ======================================================
// 06 — POLLING RESPONSABLE
// ======================================================
// polling ≠ datos nuevos: los resultados de un campeonato de fútbol
// cambian a lo más una vez por semana. Consultamos cada 5 minutos para
// mantener la fuente "viva" sin abusar de una API gratuita y compartida.

setInterval(async () => {
  if (!actualizacionAutomatica) return;

  segundosRestantes -= 1;
  document.querySelector("#cuenta-regresiva").textContent =
    formatearCuentaRegresiva(segundosRestantes);

  if (segundosRestantes <= 0) {
    segundosRestantes = INTERVALO_ACTUALIZACION;
    await cargarDatosVivos();
  }
}, 1000);

// ======================================================
// 07 — ANIMACIÓN + RESPONSIVE
// ======================================================

function animar() {
  requestAnimationFrame(animar);
  controlesOrbita.update();
  renderer.render(escena, camara);
}

function ajustarVentana() {
  const ancho = viewport.clientWidth;
  const altura = viewport.clientHeight;

  camara.aspect = ancho / altura;
  camara.updateProjectionMatrix();
  renderer.setSize(ancho, altura);
}

window.addEventListener("resize", ajustarVentana);

cargarDatosVivos();
animar();
