/* Navegación temporal del gráfico histórico: lógica pura, sin DOM ni D3 (la prueba tests/test_rango_js.py con node).
   Fechas como 'AAAA-MM-DD' o Date UTC. En el navegador queda en window.Rango; en node, module.exports. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Rango = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA = 864e5;
  var MIN_DIAS = 30;          // zoom mínimo: 1 mes
  var TOLERANCIA_DIAS = 31;   // variación del período: primer dato tardío que todavía cuenta como "al inicio"
  var DIAS_DIARIO = 731;      // petróleo diario si el rango visible es de 2 años o menos; si no, promedio mensual
  var PRESETS = ['1m', '6m', 'ytd', '1a', '5a', '10a', 'todo'];

  function d(v) { return v instanceof Date ? v : new Date(v + 'T00:00:00Z'); }
  function iso(v) { return d(v).toISOString().slice(0, 10); }
  // resta meses en UTC sin desbordar (31/03 - 1 mes = 28 o 29/02)
  function menosMeses(f, n) {
    var y = f.getUTCFullYear(), m = f.getUTCMonth() - n, dd = f.getUTCDate();
    var ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dd, ult)));
  }

  /* Rango dentro de [min, max] y de al menos MIN_DIAS. Si se pide más chico, crece alrededor de su centro;
     si se sale de los datos, se corre hacia adentro sin cambiar el ancho (salvo que no entre). */
  function limitar(desde, hasta, min, max) {
    var a = +d(desde), b = +d(hasta), lo = +d(min), hi = +d(max);
    if (b < a) { var t = a; a = b; b = t; }
    var total = hi - lo, ancho = Math.min(Math.max(b - a, MIN_DIAS * DIA), total);
    if (b - a < ancho) { var c = (a + b) / 2; a = c - ancho / 2; b = c + ancho / 2; }
    if (a < lo) { b += lo - a; a = lo; }
    if (b > hi) { a -= b - hi; b = hi; }
    if (a < lo) a = lo;
    // a día entero (las fechas de la URL y de los campos son días)
    a = Math.round(a / DIA) * DIA; b = Math.round(b / DIA) * DIA;
    return { desde: new Date(a), hasta: new Date(b) };
  }

  /* Rango de un botón: siempre termina en el último dato. YTD = desde el 1/1 del año del último dato. */
  function preset(clave, min, max) {
    var hi = d(max), a;
    switch (clave) {
      case '1m': a = menosMeses(hi, 1); break;
      case '6m': a = menosMeses(hi, 6); break;
      case 'ytd': a = new Date(Date.UTC(hi.getUTCFullYear(), 0, 1)); break;
      case '1a': a = menosMeses(hi, 12); break;
      case '5a': a = menosMeses(hi, 60); break;
      case '10a': a = menosMeses(hi, 120); break;
      default: a = d(min);
    }
    return limitar(a, hi, min, max);
  }

  /* Qué botón corresponde a un rango (para marcarlo activo), o null si es personalizado. */
  function presetDe(desde, hasta, min, max) {
    for (var i = 0; i < PRESETS.length; i++) {
      var r = preset(PRESETS[i], min, max);
      if (iso(r.desde) === iso(desde) && iso(r.hasta) === iso(hasta)) return PRESETS[i];
    }
    return null;
  }

  /* ¿Hay un hueco (sin datos) que empiece entre dos fechas? Mismo criterio que build_site_data.cruza_hueco. */
  function cruzaHueco(huecos, antes, despues) {
    return (huecos || []).some(function (h) { return antes <= h.desde && h.desde < despues; });
  }
  function enHueco(huecos, dia) {
    return (huecos || []).some(function (h) { return h.desde <= dia && (!h.hasta || dia < h.hasta); });
  }

  /* Precio vigente en un día: la última fila con fecha <= día, salvo que el día caiga en un hueco
     (nunca se arrastra un precio a través de un período sin datos). filas: [{fecha, precio}] ordenadas. */
  function vigenteEn(filas, dia, huecos) {
    var dd = iso(dia), fila = null;
    for (var i = 0; i < filas.length && filas[i].fecha <= dd; i++) fila = filas[i];
    if (!fila || enHueco(huecos, dd) || cruzaHueco(huecos, fila.fecha, dd)) return null;
    return fila;
  }

  /* Variación del período visible: precio vigente al FINAL contra el vigente al INICIO del rango
     (no contra el primer cambio dentro del rango). Si al inicio no hay precio:
     - el primer dato cae dentro de los primeros TOLERANCIA_DIAS del rango: se usa como inicio (p. ej. "Todo"
       empieza el 02/01/2009 y Kape 88 el 09/01/2009);
     - si cae después: variación desde ese primer dato, con desde = su fecha (el sitio aclara "desde mmm-aaaa").
     null si no hay precio al final, si entre inicio y final hay un hueco, o si el único dato es el del final. */
  function variacion(filas, desde, hasta, huecos) {
    var dd = iso(desde), dh = iso(hasta), parcial = null;
    var a = vigenteEn(filas, desde, huecos), b = vigenteEn(filas, hasta, huecos);
    if (!b) return null;
    if (!a) {
      for (var i = 0; i < filas.length && !a; i++) if (filas[i].fecha > dd && filas[i].fecha <= dh) a = filas[i];
      if (!a || a === b && (+d(a.fecha) - +d(dd)) / DIA > TOLERANCIA_DIAS) return null;
      if ((+d(a.fecha) - +d(dd)) / DIA > TOLERANCIA_DIAS) parcial = a.fecha;
    }
    if (!a.precio) return null;
    if (a !== b && cruzaHueco(huecos, a.fecha, b.fecha)) return null;
    return { inicio: a, fin: b, abs: b.precio - a.precio, pct: Math.round((b.precio / a.precio - 1) * 1000) / 10, desde: parcial };
  }

  function petroleoDiario(desde, hasta) { return (+d(hasta) - +d(desde)) / DIA <= DIAS_DIARIO; }

  /* Nivel del eje X según el ancho del rango: años (> 3 años), meses (> 75 días) o días. */
  function nivelEje(desde, hasta) {
    var dias = (+d(hasta) - +d(desde)) / DIA;
    return dias > 3 * 365.25 ? 'anios' : (dias > 75 ? 'meses' : 'dias');
  }

  return { MIN_DIAS: MIN_DIAS, DIAS_DIARIO: DIAS_DIARIO, PRESETS: PRESETS, iso: iso, limitar: limitar, preset: preset,
    presetDe: presetDe, vigenteEn: vigenteEn, variacion: variacion, petroleoDiario: petroleoDiario, nivelEje: nivelEje };
});
