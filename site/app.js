/* Tracker Petropar vs. petróleo. Sin build: D3 7.9.0 (jsdelivr) + SVG. Lee data.json. */
(function () {
  'use strict';

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var CORTOS = {
    diesel_mbarete: 'Mbarete', diesel_pora: 'Porã', nafta_aratiri97: 'Aratiri',
    nafta_oikoite93: 'Oikoite', nafta_kape88: 'Kape', nafta_ecoflex85: 'Ecoflex',
    glp_kg: 'Gas kg', glp_litro: 'Gas litro'
  };
  var PRES_CORTO = { 'Fernando Lugo': 'Lugo', 'Federico Franco': 'Franco', 'Horacio Cartes': 'Cartes', 'Mario Abdo Benítez': 'Abdo', 'Santiago Peña': 'Peña' };
  var OIL_NOMBRE = { wti: 'WTI', ulsd: 'Diésel ULSD' };
  var TIPO_TXT = {
    max_o_sugerido_venta_publico: 'Precio máximo y/o sugerido de venta al público (referencia, no necesariamente el precio efectivo de surtidor)',
    venta_publico: 'Venta al público'
  };
  var ESTADO_TXT = { verificado: 'verificado', derivado: 'derivado', planilla: 'planilla', a_confirmar: 'a confirmar' };
  var FECHA_ESTADO_TXT = { confirmada: 'confirmada', a_confirmar: 'a confirmar' };

  var parse = d3.utcParse('%Y-%m-%d');
  var state = { vista: 'dual', oil: 'wti', rango: 'all', tab: 'liq', sel: null };
  var D = null;          // datos crudos
  var PRODS = {};        // id -> {meta, segs}
  var OIL = {};          // wti|ulsd -> {mensual:[{d,v}], diario:[{d,iso,v}]}
  var XMIN_ALL, XMAX;
  var TRAMO = null;      // {a, b}: tramo con tipo_precio = max_o_sugerido_venta_publico (derivado de los datos)

  /* ---------- tema ----------
     El tema se fija con data-theme en <html> (script inline en index.html, antes del primer pintado).
     Claro por defecto; no sigue prefers-color-scheme. Se recuerda en localStorage (siempre en try/catch).
     ?tema=oscuro | ?tema=claro fuerza el tema solo para esa visita (útil para capturas).
     IMPORTANTE: si algún día se agrega exportar/descargar imagen del gráfico, la exportación debe
     forzar el tema claro (fondo #fcfcfb, tinta oscura), sin importar el tema activo en pantalla. */
  function temaActual() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'oscuro' : 'claro'; }
  function metaCS() {
    var mt = document.getElementById('meta-cs');
    if (mt) mt.setAttribute('content', temaActual() === 'oscuro' ? 'dark' : 'light');
  }
  function initTema() {
    var b = document.getElementById('btn-tema');
    if (!b) return;
    function sync() { b.setAttribute('aria-pressed', temaActual() === 'oscuro' ? 'true' : 'false'); }
    sync(); metaCS();
    b.addEventListener('click', function () {
      var nuevo = temaActual() === 'oscuro' ? 'claro' : 'oscuro';
      document.documentElement.setAttribute('data-theme', nuevo === 'oscuro' ? 'dark' : 'light');
      try { localStorage.setItem('tema', nuevo); } catch (e) { /* sin almacenamiento: vale solo esta visita */ }
      sync(); metaCS();
      if (D) render();
    });
  }

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function miles(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function dec(n, k) {
    var s = Number(n).toFixed(k).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return s.join(',');
  }
  function gs(n) { return 'G. ' + miles(n); }
  function fmtIso(iso) { if (!iso) return ''; var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtD(d) { return fmtIso(d.toISOString().slice(0, 10)); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function urlOk(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }
  // el id va dentro de atributos style: solo se aceptan ids simples
  function cvar(id) { return /^[a-z0-9_]+$/.test(id) ? 'var(--c-' + id + ')' : 'currentColor'; }
  function el(sel) { return document.querySelector(sel); }

  /* ---------- preparación de datos ---------- */
  function prepare(data) {
    D = data;
    var maxRow = null, minRow = null;
    (D.productos || []).forEach(function (m) {
      var rows = ((D.precios || {})[m.id] || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      rows.forEach(function (r) {
        if (!maxRow || r.fecha > maxRow) maxRow = r.fecha;
        if (!minRow || r.fecha < minRow) minRow = r.fecha;
      });
      PRODS[m.id] = { meta: m, rows: rows, segs: [] };
    });
    var ult = (D.ultimo_dato && D.ultimo_dato.petropar) || iso(new Date());
    // los precios siguen vigentes hasta que se generó data.json, no solo hasta el último cambio
    var gen = D.generado ? String(D.generado).slice(0, 10) : '';
    var finIso = [ult, maxRow || '', gen].sort().pop();
    XMAX = parse(finIso);
    XMIN_ALL = parse(minRow && minRow < '2009-01-02' ? minRow : '2009-01-01');
    if (minRow && minRow > '2009-01-01') XMIN_ALL = parse(minRow);

    // tramo de precio máximo/sugerido: primera y última fecha con ese tipo, hasta la primera fila de venta al público
    var mxA = '', vpA = '';
    Object.keys(PRODS).forEach(function (id) {
      PRODS[id].rows.forEach(function (r) {
        if (r.tipo_precio === 'max_o_sugerido_venta_publico' && (!mxA || r.fecha < mxA)) mxA = r.fecha;
        if (r.tipo_precio === 'venta_publico' && (!vpA || r.fecha < vpA)) vpA = r.fecha;
      });
    });
    TRAMO = mxA ? { a: parse(mxA), b: parse(vpA || finIso), aIso: mxA, bIso: vpA } : null;

    Object.keys(PRODS).forEach(function (id) {
      var p = PRODS[id], cut = p.meta.datos_hasta;
      p.gaps = [];
      function mk(rows) { return rows.map(function (r) { return { d: parse(r.fecha), v: r.precio, row: r }; }); }
      if (cut) {
        var A = p.rows.filter(function (r) { return r.fecha <= cut; });
        var B = p.rows.filter(function (r) { return r.fecha > cut; });
        if (A.length) p.segs.push({ pts: mk(A), end: parse(cut) });
        if (B.length) p.segs.push({ pts: mk(B), end: XMAX });
        // hueco sin fuente: nunca se arrastra el precio; va de datos_hasta a la primera fila posterior
        if (A.length && B.length) p.gaps.push({ a: parse(cut), b: parse(B[0].fecha), aIso: cut, bIso: B[0].fecha });
      } else if (p.rows.length) {
        p.segs.push({ pts: mk(p.rows), end: XMAX });
      }
    });

    ['wti', 'ulsd'].forEach(function (k) {
      var o = (D.petroleo || {})[k];
      if (!o) return;
      OIL[k] = {
        mensual: (o.mensual || []).map(function (r) { return { d: parse(r[0]), v: r[1] }; }),
        diario: (o.diario || []).map(function (r) { return { d: parse(r[0]), iso: r[0], v: r[1] }; })
      };
    });
  }

  function seriesPrice(id) {
    var p = PRODS[id];
    if (!p || !p.segs.length) return null;
    return { id: id, kind: 'price', name: p.meta.nombre, short: CORTOS[id] || p.meta.nombre, color: cvar(id), segs: p.segs, gaps: p.gaps,
      hasMax: p.rows.some(function (r) { return r.tipo_precio === 'max_o_sugerido_venta_publico'; }) };
  }
  function seriesOil(k) {
    var o = OIL[k];
    if (!o || !o.mensual.length) return null;
    var last = o.mensual[o.mensual.length - 1].d;
    return { id: 'oil_' + k, kind: 'oil', key: k, name: OIL_NOMBRE[k], short: k === 'wti' ? 'WTI' : 'ULSD', color: 'var(--oil)',
      segs: [{ pts: o.mensual, end: last }], gaps: [] };
  }
  function gapAt(s, t) {
    var gs_ = s.gaps || [];
    for (var i = 0; i < gs_.length; i++) if (t > gs_[i].a && t < gs_[i].b) return gs_[i];
    var last = s.segs[s.segs.length - 1];
    if (s.kind === 'price' && XMAX - last.end > 864e5 * 2 && t > last.end) return { a: last.end, b: null };
    return null;
  }
  function firstD(s) { return s.segs[0].pts[0].d; }
  function lastEnd(s) { return s.segs[s.segs.length - 1].end; }

  var bisD = d3.bisector(function (p) { return p.d; }).right;
  // punto de precio vigente en t (o null si hay hueco / antes del primer dato)
  function pointAt(s, t) {
    for (var i = 0; i < s.segs.length; i++) {
      var g = s.segs[i];
      if (t >= g.pts[0].d && t <= g.end) { return g.pts[bisD(g.pts, t) - 1]; }
    }
    return null;
  }
  // valor para la base del índice: vigente en t, o el primero posterior, o el último
  function baseValue(s, t) {
    var p = s.kind === 'oil'
      ? (function () { var pts = s.segs[0].pts, i = bisD(pts, t) - 1; return pts[Math.max(0, i)]; })()
      : pointAt(s, t);
    if (!p) {
      for (var i = 0; i < s.segs.length && !p; i++) {
        for (var j = 0; j < s.segs[i].pts.length; j++) if (s.segs[i].pts[j].d >= t) { p = s.segs[i].pts[j]; break; }
      }
    }
    if (!p) { var g = s.segs[s.segs.length - 1]; p = g.pts[g.pts.length - 1]; }
    return p.v;
  }

  /* ---------- escalas ---------- */
  function niceOilStep(max, n) {
    var need = max / n, base = Math.pow(10, Math.floor(Math.log10(need)));
    var mult = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < mult.length; i++) if (base * mult[i] >= need) return base * mult[i];
    return base * 10;
  }
  function yMaxVisible(list, xmin, xmax) {
    var m = 0;
    list.forEach(function (s) {
      s.segs.forEach(function (g) {
        g.pts.forEach(function (p) { if (p.d >= xmin && p.d <= xmax && p.v > m) m = p.v; });
      });
      var p0 = pointAt(s, xmin); if (p0 && p0.v > m) m = p0.v;
    });
    return m;
  }

  /* ---------- colisión de etiquetas ---------- */
  function relax(items, gap, top, bottom) {
    items.sort(function (a, b) { return a.y0 - b.y0; });
    items.forEach(function (it) { it.y = it.y0; });
    var n = items.length; if (!n) return;
    var i;
    for (i = 1; i < n; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    if (items[n - 1].y > bottom) {
      items[n - 1].y = bottom;
      for (i = n - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < gap) items[i].y = items[i + 1].y - gap;
    }
    if (items[0].y < top) {
      items[0].y = top;
      for (i = 1; i < n; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    }
  }

  /* ---------- gráfico ---------- */
  var charts = {};   // host.id -> {redraw, pinned}

  function drawChart(hostId, o) {
    var host = document.getElementById(hostId);
    var W = Math.floor(host.clientWidth);
    if (W < 50) return;                                  // oculto
    host.innerHTML = '';
    var mobile = W < 600;
    var showOil = !!o.oil;
    var index = o.view === 'index';
    var lista = o.series.slice();                        // precios
    if (!lista.length && !showOil) {
      host.innerHTML = '<div class="vacio">' + esc(o.vacio || 'Sin datos para mostrar.') + '</div>';
      return;
    }
    var all = lista.concat(showOil ? [o.oil] : []);

    // rango x
    var xmax = XMAX, xmin = XMIN_ALL;
    if (o.rango !== 'all') {
      xmin = new Date(Date.UTC(xmax.getUTCFullYear() - (+o.rango), xmax.getUTCMonth(), xmax.getUTCDate()));
      if (xmin < XMIN_ALL) xmin = XMIN_ALL;
    }

    if (o.xDesdeDatos && lista.length) {   // p. ej. GLP: el eje arranca en su primer dato (con margen de 60 días)
      xmin = new Date(+d3.min(lista, firstD) - 60 * 864e5);
    }

    // layout
    var dualAx = showOil && !index;
    var axisR = dualAx && !mobile ? 58 : 0;   // en móvil los ticks US$ van por dentro del área
    var labW = mobile ? 0 : 178;      // en móvil las etiquetas finales van en un bloque debajo del gráfico
    var m = { top: 48, left: mobile ? 41 : 64, bottom: 26, right: axisR + (mobile ? 8 : labW + 4) };
    var H = o.altura || (mobile ? 420 : Math.max(440, Math.min(560, Math.round(W * 0.5))));
    var iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    var fs = mobile ? 10.5 : 12;
    var x = d3.scaleUtc().domain([xmin, xmax]).range([0, iw]);
    var fs2 = fs + 3;
    var band = 2 * fs2 + 8;           // franja superior reservada (hitos, rótulo de tramo); los datos no entran

    // índice: base
    var base = null, baseVals = {};
    var activas = all.filter(function (s) { return lastEnd(s) >= xmin && firstD(s) <= xmax; });
    if (index && activas.length) {
      base = new Date(Math.max.apply(null, activas.map(function (s) { return Math.max(+xmin, +firstD(s)); })));
      if (base > xmax) base = xmax;
      activas.forEach(function (s) { baseVals[s.id] = baseValue(s, base); });
    }
    var tr = function (s, v) { return index ? (baseVals[s.id] ? v / baseVals[s.id] * 100 : NaN) : v; };

    // escalas y
    var yL, yR = null, ticksL, ticksR = null, decR = 1;
    var priceAct = lista.filter(function (s) { return activas.indexOf(s) >= 0; });
    if (index) {
      var lo = Infinity, hi = -Infinity;
      activas.forEach(function (s) {
        s.segs.forEach(function (g) {
          g.pts.forEach(function (p) {
            if (p.d >= xmin && p.d <= xmax) { var v = tr(s, p.v); if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        });
      });
      if (!isFinite(lo)) { lo = 50; hi = 150; }
      lo = Math.min(lo, 100) * 0.92; hi = Math.max(hi, 100) * 1.05;
      yL = d3.scaleLinear().domain([lo, hi]).range([ih, band]).nice(5);
      ticksL = yL.ticks(5);
    } else {
      var mx = yMaxVisible(priceAct, xmin, xmax) || 12000;
      var raw = mx * 1.04, step = 10000, cs = [500, 1000, 2000, 2500, 5000, 10000];
      for (var ci = 0; ci < cs.length; ci++) { if (Math.ceil(raw / cs[ci]) <= 6) { step = cs[ci]; break; } }
      var n = Math.max(1, Math.ceil(raw / step));
      ticksL = d3.range(0, n + 1).map(function (i) { return i * step; });
      yL = d3.scaleLinear().domain([0, step * n]).range([ih, band]);
      if (dualAx) {
        var oilAct = activas.indexOf(o.oil) >= 0;
        var om = oilAct ? yMaxVisible([o.oil], xmin, xmax) : 3;
        var rs = niceOilStep((om || 3) * 1.05, n);
        yR = d3.scaleLinear().domain([0, rs * n]).range([ih, band]);
        ticksR = d3.range(0, n + 1).map(function (i) { return i * rs; });
        decR = rs % 1 === 0 ? 0 : (Math.abs(rs * 10 - Math.round(rs * 10)) < 1e-9 ? 1 : 2);
      }
    }
    var yOf = function (s, v) { return (s.kind === 'oil' && yR) ? yR(v) : yL(tr(s, v)); };

    // svg
    var svg = d3.select(host).append('svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', o.aria || 'Gráfico de precios');
    var uid = hostId + '-c';
    var defs = svg.append('defs');
    defs.append('clipPath').attr('id', uid).append('rect').attr('x', 0).attr('y', -2).attr('width', iw).attr('height', ih + 4);
    var pat = defs.append('pattern').attr('id', uid + 'p').attr('width', 6).attr('height', 6)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).style('stroke', 'var(--promo)').attr('stroke-width', 2.5);
    var pat2 = defs.append('pattern').attr('id', uid + 'm').attr('width', 7).attr('height', 7)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(-45)');
    pat2.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7).style('stroke', 'var(--muted)').attr('stroke-width', 1);
    var g = svg.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')');

    // sombreado presidentes
    var gp = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var presVis = [];
    (D.presidentes || []).forEach(function (pr, i) {
      var a = parse(pr.inicio), b = pr.fin ? parse(pr.fin) : xmax;
      var a2 = a < xmin ? xmin : a, b2 = b > xmax ? xmax : b;
      if (b2 <= a2) return;
      presVis.push(pr);
      gp.append('rect').attr('x', x(a2)).attr('width', Math.max(0, x(b2) - x(a2))).attr('y', 0).attr('height', ih)
        .style('fill', i % 2 ? 'var(--shade-b)' : 'var(--shade-a)');
      var w = x(b2) - x(a2);
      var t = g.append('text').attr('class', 'pres').attr('text-anchor', 'middle').attr('x', (x(a2) + x(b2)) / 2).attr('y', -28)
        .attr('font-size', mobile ? 10 : 11.5).text(mobile ? (PRES_CORTO[pr.nombre] || pr.nombre) : pr.nombre);
      try {
        if (t.node().getComputedTextLength() > w - 4) {
          t.text(PRES_CORTO[pr.nombre] || pr.nombre);
          if (t.node().getComputedTextLength() > w - 4) t.remove();
        }
      } catch (e) { /* sin medición */ }
    });

    // tramo 2009-2014: precio máximo y/o sugerido (trama sutil + rótulo en la franja superior)
    var tramoVis = !!(TRAMO && TRAMO.b > xmin && TRAMO.a < xmax && lista.some(function (s) { return s.hasMax; }));
    if (tramoVis) {
      var ta = Math.max(0, x(TRAMO.a)), tb = Math.min(iw, x(TRAMO.b));
      gp.append('rect').attr('x', ta).attr('width', Math.max(0, tb - ta)).attr('y', 0).attr('height', ih)
        .style('fill', 'url(#' + uid + 'm)').attr('opacity', 0.22);
      gp.append('line').attr('x1', tb).attr('x2', tb).attr('y1', band).attr('y2', ih).style('stroke', 'var(--muted)')
        .attr('stroke-width', 1).attr('opacity', 0.35);
      g.append('text').attr('class', 'halo tramo-t').attr('x', ta + 4).attr('y', fs + 1).attr('font-size', mobile ? 10 : 11)
        .text('Precio máximo/sugerido');
    }

    // grilla y ejes
    g.append('g').attr('class', 'grid').selectAll('line').data(ticksL).join('line')
      .attr('x1', 0).attr('x2', iw).attr('y1', yL).attr('y2', yL);
    var fmtL = index ? function (v) { return dec(v, 0); } : function (v) { return miles(v); };
    g.append('g').attr('class', 'axis').call(d3.axisLeft(yL).tickValues(ticksL).tickFormat(fmtL).tickSize(0).tickPadding(6))
      .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
    var nY = (xmax - xmin) / (365.25 * 864e5);
    var tickV, fmtX;
    if (nY <= 3.2) {
      tickV = d3.utcMonth.every(mobile ? 6 : 3).range(xmin, xmax);
      fmtX = function (d) { return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MESES[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); };
    } else {
      var k = Math.max(1, Math.ceil(nY * (mobile ? 40 : 50) / iw));
      if (k === 3) k = 4; if (k > 4 && k < 10) k = 5;
      tickV = d3.utcYear.every(k).range(xmin, xmax);
      fmtX = function (d) { return String(d.getUTCFullYear()); };
    }
    g.append('g').attr('class', 'axis').attr('transform', 'translate(0,' + ih + ')')
      .call(d3.axisBottom(x).tickValues(tickV).tickFormat(fmtX).tickSize(0).tickPadding(8))
      .selectAll('text').attr('font-size', fs);
    // captions de ejes
    g.append('text').attr('x', -m.left + 2).attr('y', -9).attr('font-size', mobile ? 10 : 11.5)
      .text(index ? 'Índice (base 100)' : (o.ejeL || 'Gs por litro'));
    if (dualAx) {
      if (mobile) {
        /* ticks US$ en móvil: se dibujan después de las líneas (con halo) */
      } else {
        g.append('g').attr('class', 'axis').attr('transform', 'translate(' + iw + ',0)')
          .call(d3.axisRight(yR).tickValues(ticksR).tickFormat(function (v) { return 'US$ ' + dec(v, decR); }).tickSize(0).tickPadding(6))
          .call(function (a) { a.select('.domain').remove(); }).selectAll('text').attr('font-size', fs);
      }
      g.append('text').attr('x', iw + axisR).attr('text-anchor', 'end').attr('y', -9).attr('font-size', mobile ? 10 : 11.5)
        .text(mobile ? 'US$/gal' : 'US$ por galón (' + o.oil.short + ')');
    }

    // eventos
    var gc = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var evs = (D.eventos || []).map(function (e) {
      return { e: e, a: parse(e.fecha), b: e.fecha_fin ? parse(e.fecha_fin) : null };
    }).filter(function (v) { return v.a && (v.b || v.a) >= xmin && v.a <= xmax; });
    // promos: banda con trama si hay fecha_fin posterior a fecha; si no, marcador ▲ sobre el eje X.
    // Solo en combustibles líquidos (o.sinPromos en GLP). Van debajo de la franja reservada para hitos.
    // Si una promo queda a menos de ~6 px de un hito, la promo ocupa la mitad inferior y la línea del hito se corta
    // donde empieza la promo, para que no se fundan.
    var hitosV = evs.filter(function (v) { return v.e.tipo !== 'promo'; });
    var promosV = o.sinPromos ? [] : evs.filter(function (v) { return v.e.tipo === 'promo'; });
    var hitoFin = hitosV.map(function () { return ih; });
    var mid = band + (ih - band) / 2, hayBanda = false, hayTri = false;
    promosV.forEach(function (v) {
      var x1 = x(v.a), span = v.b && v.b > v.a, x2 = span ? x(v.b) : x1;
      var w = span ? Math.max(6, x2 - x1) : 11, xa = (x1 + x2) / 2 - w / 2, xb = xa + w;
      var col = false;
      hitosV.forEach(function (h, k) {
        var hx = x(h.a);
        if (hx >= xa - 6 && hx <= xb + 6) { col = true; hitoFin[k] = Math.min(hitoFin[k], span ? mid : ih - 14); }
      });
      if (span) {
        hayBanda = true;
        var y0 = col ? mid : band;
        gc.append('rect').attr('x', xa).attr('width', w).attr('y', y0).attr('height', ih - y0)
          .style('fill', 'url(#' + uid + 'p)').attr('opacity', 0.7);
        gc.append('rect').attr('x', xa).attr('width', w).attr('y', y0).attr('height', ih - y0)
          .attr('fill', 'none').style('stroke', 'var(--promo)').attr('stroke-width', 1.2);
      } else {
        hayTri = true;
        gc.append('path').attr('d', 'M' + (x1 - 5.5) + ',' + ih + 'l5.5,-9l5.5,9z').style('fill', 'var(--promo)')
          .style('stroke', 'var(--bg)').attr('stroke-width', 1);
      }
    });
    // hitos: líneas desde debajo de la franja superior (así no cruzan ninguna etiqueta) y rótulos con halo en la franja
    hitosV.forEach(function (v, k) {
      var xx = x(v.a);
      g.append('line').attr('class', 'hito-l').attr('x1', xx).attr('x2', xx).attr('y1', band).attr('y2', hitoFin[k]);
    });
    hitosV.forEach(function (v, k) {
      var xx = x(v.a);
      var txt = mobile ? v.e.etiqueta.replace(/\s*\(.*?\)/g, '') : v.e.etiqueta;
      var tt = g.append('text').attr('class', 'hito-t halo').attr('y', fs + 1 + (k % 2) * fs2)
        .attr('font-size', mobile ? 10 : 11).text(txt);
      var tl = 0; try { tl = tt.node().getComputedTextLength(); } catch (e) { tl = txt.length * 6; }
      var spR = iw - xx - 5, spL = xx - 5, right = tl <= spR ? false : (tl <= spL ? true : spL > spR);
      var sp = right ? spL : spR;
      if (tl > sp && sp > 20) tt.text(txt.slice(0, Math.max(3, Math.floor(txt.length * sp / tl) - 1)) + '…');
      tt.attr('x', xx + (right ? -5 : 5)).attr('text-anchor', right ? 'end' : 'start');
    });

    // marcador base 100
    if (index && base) {
      g.append('line').attr('class', 'base-l').attr('x1', 0).attr('x2', iw).attr('y1', yL(100)).attr('y2', yL(100));
      g.append('line').attr('class', 'base-l').attr('x1', x(base)).attr('x2', x(base)).attr('y1', 0).attr('y2', ih);
      g.append('text').attr('class', 'halo').attr('x', x(base) + 4).attr('y', ih - 6).attr('font-size', fs - 1)
        .text('base 100: ' + fmtD(base));
    }

    // líneas
    var gl = g.append('g').attr('clip-path', 'url(#' + uid + ')');
    var orden = all.slice().sort(function (a, b) { return (a.kind === 'oil' ? -1 : 0) - (b.kind === 'oil' ? -1 : 0); });
    orden.forEach(function (s) {
      s.segs.forEach(function (sg) {
        var pts = sg.pts.map(function (p) { return { d: p.d, v: p.v }; });
        if (s.kind === 'price') pts.push({ d: sg.end, v: pts[pts.length - 1].v });
        var ln = d3.line().defined(function (p) { return isFinite(tr(s, p.v)); })
          .x(function (p) { return x(p.d); }).y(function (p) { return yOf(s, p.v); })
          .curve(s.kind === 'price' ? d3.curveStepAfter : d3.curveLinear);
        var path = gl.append('path').attr('d', ln(pts)).attr('fill', 'none').style('stroke', s.color)
          .attr('stroke-linejoin', 'round');
        if (s.kind === 'oil') {
          path.attr('stroke-width', mobile ? 2 : 2.4).attr('stroke-linecap', 'round').attr('stroke-dasharray', mobile ? '0.1 4.5' : '0.1 5.5');
        } else {
          path.attr('stroke-width', mobile ? 2 : 2.4);
        }
      });
    });
    // ticks US$ del eje derecho en móvil: después de las líneas, con halo
    if (dualAx && mobile) {
      g.append('g').selectAll('text').data(ticksR.filter(function (v) { return yR(v) > band + 10; })).join('text').attr('class', 'halo')
        .attr('x', iw - 3).attr('y', function (v) { return yR(v) - 3; })
        .attr('text-anchor', 'end').attr('font-size', fs - 1).text(function (v) { return dec(v, decR); });
    }

    // puntos no firmes (círculo hueco) y bordes de huecos sin fuente (rombo); fuera del clip para no cortarse en los bordes.
    // (Sin <title>: el rect de interacción quedaría encima; el cuadro emergente propio explica el hueco.)
    var gm = g.append('g'), nGapMarks = 0, nNoFirme = 0;
    lista.forEach(function (s) {
      var postGap = {};
      (s.gaps || []).forEach(function (hg) { postGap[hg.bIso] = true; });
      s.segs.forEach(function (sg) {
        sg.pts.forEach(function (p) {
          if (p.row && p.row.firme === false && p.d >= xmin && p.d <= xmax && !postGap[p.row.fecha]) {
            nNoFirme++;
            gm.append('circle').attr('cx', x(p.d)).attr('cy', yOf(s, p.v)).attr('r', mobile ? 3.5 : 4.5)
              .style('fill', 'var(--bg)').style('stroke', s.color).attr('stroke-width', 2);
          }
        });
      });
      // hueco: último punto conocido antes (a) y primero después (b); nunca se arrastra el precio
      (s.gaps || []).forEach(function (hg) {
        if (hg.b < xmin || hg.a > xmax) return;
        var sa = s.segs.filter(function (sg) { return +sg.end === +hg.a; })[0];
        var sb = s.segs.filter(function (sg) { return +sg.pts[0].d === +hg.b; })[0];
        if (!sa || !sb) return;
        var pa = sa.pts[sa.pts.length - 1], pb = sb.pts[0], r = mobile ? 5 : 6;
        [[hg.a, pa.v, true], [hg.b, pb.v, pb.row && pb.row.firme !== false]].forEach(function (q) {
          if (q[0] < xmin || q[0] > xmax) return;
          nGapMarks++;
          var cx = x(q[0]), cy = yOf(s, q[1]);
          gm.append('path').attr('d', 'M' + cx + ',' + (cy - r) + 'l' + r + ',' + r + 'l' + (-r) + ',' + r + 'l' + (-r) + ',' + (-r) + 'z')
            .style('fill', q[2] ? s.color : 'var(--bg)').style('stroke', s.color).attr('stroke-width', 2);
        });
      });
    });

    // etiquetas directas
    var lab = [], fin = [];
    all.forEach(function (s) {
      if (activas.indexOf(s) < 0) return;
      var gLast = s.segs[s.segs.length - 1], pl = gLast.pts[gLast.pts.length - 1];
      var v = tr(s, pl.v);
      if (!isFinite(v)) return;
      var alcanza = s.kind === 'oil' || (xmax - gLast.end) < 864e5 * 2;
      if (alcanza) {
        lab.push({ s: s, y0: yOf(s, pl.v), v: v });
      } else if (gLast.end >= xmin) {
        fin.push({ s: s, x: x(gLast.end), y: yOf(s, pl.v), end: gLast.end });
      }
    });
    var gap = fs + 3;
    var lx = iw + axisR + 6;
    function valTxt(s, v) {
      if (index) return dec(v, 0);
      return s.kind === 'oil' ? 'US$ ' + dec(v, 2) + '/gal' : miles(v);
    }
    if (mobile) {
      // móvil: puntos sobre la línea y un bloque de valores debajo del gráfico (texto en tinta del tema)
      lab.forEach(function (it) { g.append('circle').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', it.s.color); });
    } else {
      relax(lab, gap, band, ih + 6);
      lab.forEach(function (it) {
        var s = it.s;
        g.append('circle').attr('cx', iw).attr('cy', it.y0).attr('r', 3).style('fill', s.color);
        if (Math.abs(it.y - it.y0) > 1) {
          g.append('line').attr('x1', iw).attr('y1', it.y0).attr('x2', lx).attr('y2', it.y).style('stroke', s.color).attr('stroke-width', 1);
        }
        var sw = g.append('g').attr('transform', 'translate(' + lx + ',' + it.y + ')');
        if (s.kind === 'oil') {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color)
            .attr('stroke-width', 2.6).attr('stroke-linecap', 'round').attr('stroke-dasharray', '0.1 5');
        } else {
          sw.append('line').attr('x1', 0).attr('x2', 14).attr('y1', 0).attr('y2', 0).style('stroke', s.color).attr('stroke-width', 3);
        }
        var tx = sw.append('text').attr('x', 18).attr('y', 0).attr('dy', '0.34em').attr('font-size', fs)
          .attr('class', s.kind === 'oil' ? 'lbl-oil' : 'lbl-v');
        tx.append('tspan').text((s.kind === 'oil' ? s.short : s.name) + ' ');
        tx.append('tspan').attr('font-weight', 700).text(valTxt(s, it.v));
      });
    }
    fin.forEach(function (it) {
      // marcador discreto del corte (el texto "dato hasta" está en tabla, nota y tooltip)
      g.append('line').attr('x1', it.x).attr('x2', it.x).attr('y1', it.y - 7).attr('y2', it.y + 7).style('stroke', it.s.color).attr('stroke-width', 2.5);
    });

    if (mobile) {
      var fb = document.createElement('ul');
      fb.className = 'finales';
      var items = lab.slice().sort(function (a, b) { return a.y0 - b.y0; }).map(function (it) {
        return { s: it.s, txt: valTxt(it.s, it.v) };
      }).concat(fin.map(function (it) { return { s: it.s, txt: 'dato hasta ' + fmtD(it.end) }; }));
      fb.innerHTML = items.map(function (it) {
        return '<li><span class="sw' + (it.s.kind === 'oil' ? ' sw-oil' : '') + '" style="border-color:' + it.s.color + '"></span> '
          + esc(it.s.kind === 'oil' ? it.s.short : it.s.name) + ' <strong>' + esc(it.txt) + '</strong></li>';
      }).join('');
      host.appendChild(fb);
    }

    // interacción
    var guia = g.append('line').attr('class', 'guia').attr('y1', 0).attr('y2', ih).style('display', 'none');
    var foco = g.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke-width', 2).style('display', 'none');
    var tip = document.createElement('div');
    tip.className = 'tt'; tip.hidden = true;
    host.appendChild(tip);
    var st = charts[hostId] = charts[hostId] || {};
    st.pinned = false;

    function inspect(px, py) {
      var t = x.invert(px);
      var cand = [];
      lista.forEach(function (s) {
        var p = pointAt(s, t);
        if (p) cand.push({ s: s, p: p, y: yOf(s, p.v) });
      });
      var best = null;
      cand.forEach(function (c) { var dd = Math.abs(c.y - py); if (!best || dd < best.dd) { best = c; best.dd = dd; } });
      var h = '<h3>' + esc(fmtD(t)) + '</h3>';
      if (best) {
        var r = best.p.row, s = best.s;
        h += '<div><span class="sw" style="border-color:' + s.color + '"></span> <strong>' + esc(s.name) + ': ' + gs(r.precio) + (o.unidadTxt ? ' ' + esc(o.unidadTxt(s)) : '') + '</strong>'
          + (index ? ' <span class="f">(índice ' + dec(tr(s, r.precio), 1) + ')</span>' : '') + '</div>';
        h += '<div><span class="f">Vigente desde:</span> ' + fmtIso(r.fecha) + '</div>';
        h += '<div><span class="f">Tipo de precio:</span> ' + esc(TIPO_TXT[r.tipo_precio] || r.tipo_precio) + '</div>';
        h += '<div><span class="f">Estado:</span> ' + esc(ESTADO_TXT[r.estado] || r.estado)
          + ' · <span class="f">fecha:</span> ' + esc(FECHA_ESTADO_TXT[r.fecha_estado] || r.fecha_estado)
          + (r.firme === false ? ' <span class="nofirme">no firme</span>' : '') + '</div>';
        if (r.fuente) h += '<div><span class="f">Fuente:</span> ' + esc(r.fuente) + '</div>';
        var us = (r.urls || []).filter(urlOk);
        if (us.length) {
          h += '<div>' + us.map(function (u, i) {
            return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Enlace a la fuente' + (us.length > 1 ? ' ' + (i + 1) : '') + '</a>';
          }).join(' · ') + '</div>';
        }
        if (r.nota) h += '<div class="f">' + esc(r.nota) + '</div>';
        if (cand.length > 1) {
          h += '<div class="sep"><span class="f">Otros productos ese día:</span></div>';
          cand.forEach(function (c) {
            if (c === best) return;
            h += '<div><span class="sw" style="border-color:' + c.s.color + ';width:12px"></span> ' + esc(c.s.name) + ': ' + gs(c.p.v)
              + (index ? ' <span class="f">(' + dec(tr(c.s, c.p.v), 1) + ')</span>' : '') + '</div>';
          });
        }
        st.foco = { x: x(best.p.d), y: best.y, color: best.s.color };
      } else {
        h += '<div class="f">Sin precio vigente de los productos elegidos en esta fecha.</div>';
        st.foco = null;
      }
      lista.forEach(function (s) {
        var hg = gapAt(s, t);
        if (hg && !hg.b) h += '<div class="sep"><span class="sw" style="border-color:' + s.color + ';width:12px"></span> <strong>' + esc(s.name)
          + '</strong>: sin datos desde ' + fmtD(hg.a) + '.</div>';
        else if (hg) h += '<div class="sep"><span class="sw" style="border-color:' + s.color + ';width:12px"></span> <strong>' + esc(s.name)
          + '</strong>: sin datos entre ' + fmtD(hg.a) + ' y ' + fmtD(hg.b) + '. <span class="f">No se estima ni se arrastra el último precio.</span></div>';
      });
      if (tramoVis && t >= TRAMO.a && t < TRAMO.b) {
        h += '<div class="sep f">Entre ' + fmtD(TRAMO.a) + ' y ' + fmtD(TRAMO.b)
          + ' el dato es el precio máximo y/o sugerido, no el precio de venta al público.</div>';
      }
      if (showOil && OIL[o.oil.key]) {
        var od = OIL[o.oil.key].diario, i = d3.bisector(function (q) { return q.d; }).left(od, t);
        var c1 = od[Math.max(0, i - 1)], c2 = od[Math.min(od.length - 1, i)], c = c1 || c2;
        if (c1 && c2 && Math.abs(c2.d - t) < Math.abs(c1.d - t)) c = c2;
        var mp = o.oil.segs[0].pts, mi = bisD(mp, t) - 1, mm = mp[Math.max(0, mi)];
        if (c) {
          h += '<div class="sep"><span class="sw" style="border-color:var(--oil);border-top-style:dotted"></span> <strong>' + esc(o.oil.name) + '</strong>: US$ ' + dec(c.v, 2) + '/gal'
            + ' <span class="f">(diario, ' + fmtIso(c.iso) + ')</span>'
            + (mm ? '<br><span class="f">Promedio mensual (' + MESES[mm.d.getUTCMonth()] + ' ' + mm.d.getUTCFullYear() + '):</span> US$ ' + dec(mm.v, 2) + '/gal' : '') + '</div>';
        }
      }
      // eventos cercanos
      var near = evs.filter(function (v) {
        var x1 = x(v.a), x2 = v.b ? x(v.b) : x1;
        return px >= x1 - 6 && px <= x2 + 6;
      });
      near.forEach(function (v) {
        var e = v.e;
        h += '<div class="sep"><strong>' + (e.tipo === 'promo' ? 'Promoción: ' : 'Hito: ') + esc(e.etiqueta) + '</strong><br><span class="f">'
          + fmtIso(e.fecha) + (e.fecha_fin ? ' al ' + fmtIso(e.fecha_fin) : '') + '</span>'
          + (e.fuente ? '<br><span class="f">Fuente:</span> ' + esc(e.fuente) : '')
          + (urlOk(e.url) ? ' <a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">enlace</a>' : '')
          + (e.nota ? '<br><span class="f">' + esc(e.nota) + '</span>' : '') + '</div>';
      });
      return { html: h, t: t };
    }

    function mostrar(px, py, fijar) {
      var r = inspect(px, py);
      tip.innerHTML = (fijar ? '<button class="x" aria-label="Cerrar">&times;</button>' : '') + r.html;
      tip.hidden = false;
      tip.classList.toggle('fijo', !!fijar);
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = m.left + px + 14;
      if (left + tw > W - 2) left = m.left + px - tw - 14;
      if (left < 2) left = Math.max(2, Math.min(W - tw - 2, 2));
      var top = Math.max(2, Math.min(H - th - 2, m.top + py - th / 2));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      guia.style('display', null).attr('x1', px).attr('x2', px);
      if (st.foco) foco.style('display', null).attr('cx', st.foco.x).attr('cy', st.foco.y).style('stroke', st.foco.color);
      else foco.style('display', 'none');
      var b = tip.querySelector('.x');
      if (b) b.addEventListener('click', function (ev) { ev.stopPropagation(); ocultar(true); });
    }
    function ocultar(force) {
      if (st.pinned && !force) return;
      st.pinned = false; tip.hidden = true; tip.classList.remove('fijo');
      guia.style('display', 'none'); foco.style('display', 'none');
    }
    var ov = g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'crosshair');
    function loc(ev) { var r = ov.node().getBoundingClientRect(); return [Math.max(0, Math.min(iw, ev.clientX - r.left)), Math.max(0, Math.min(ih, ev.clientY - r.top))]; }
    ov.on('pointermove', function (ev) {
      if (st.pinned || ev.pointerType === 'touch') return;
      var p = loc(ev); mostrar(p[0], p[1], false);
    });
    ov.on('pointerleave', function (ev) { if (ev.pointerType !== 'touch') ocultar(false); });
    ov.on('click', function (ev) { var p = loc(ev); st.pinned = true; mostrar(p[0], p[1], true); });
    svg.on('keydown', null);
    st.esc = function () { ocultar(true); };

    // leyenda
    var lg = document.getElementById(o.leyendaId);
    if (lg) lg.innerHTML = leyendaHtml({
      nofirme: nNoFirme > 0,
      hueco: nGapMarks > 0, hito: hitosV.length > 0, banda: hayBanda, tri: hayTri, tramo: tramoVis, pres: presVis
    });

    // avisos y datos de la base
    if (o.onInfo) o.onInfo({ base: base, activas: activas.length });
  }

  // Leyenda: solo clave de símbolos (productos y petróleo ya están en chips y etiquetas finales)
  function leyendaHtml(f) {
    var h = '';
    if (f.nofirme) h += '<span class="it"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Punto no firme (precio no verificado o fecha por confirmar)</span>';
    if (f.hueco) h += '<span class="it"><svg width="14" height="14" aria-hidden="true"><path d="M7,1 L13,7 L7,13 L1,7z" fill="currentColor"/></svg>Borde de un hueco sin datos</span>';
    if (f.hito) h += '<span class="it"><svg width="22" height="10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="currentColor" style="color:var(--hito)" stroke-width="1.5" stroke-dasharray="6 4"/></svg>Hito</span>';
    if (f.banda || f.tri) h += '<span class="it"><svg width="34" height="14" aria-hidden="true"><defs><pattern id="lgp" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" style="color:var(--promo)" stroke-width="2"/></pattern></defs><rect x="0" y="0" width="18" height="12" fill="url(#lgp)" stroke="currentColor" style="color:var(--promo)"/><path d="M26,12 l5,-9 l5,9z" fill="currentColor" style="color:var(--promo)" transform="translate(-4,0)"/></svg>Promoción o baja temporal (' + (f.banda && f.tri ? 'banda con fecha de fin; ▲ si no la tiene' : (f.banda ? 'banda con trama' : '▲ sobre el eje')) + ')</span>';
    if (f.tramo) h += '<span class="it"><svg width="18" height="14" aria-hidden="true"><defs><pattern id="lgm" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" style="color:var(--muted)" stroke-width="1"/></pattern></defs><rect width="18" height="12" fill="url(#lgm)" stroke="currentColor" style="color:var(--faint)" stroke-width="0.5"/></svg>Precio máximo/sugerido (trama)</span>';
    if (f.pres.length) h += '<span class="it"><svg width="18" height="12" aria-hidden="true"><rect width="9" height="12" style="fill:var(--shade-a)"/><rect x="9" width="9" height="12" style="fill:var(--shade-b)"/></svg>Sombreado: período presidencial (' + f.pres.map(function (p) { return esc(PRES_CORTO[p.nombre] || p.nombre); }).join(', ') + ')</span>';
    return h;
  }

  /* ---------- paneles ---------- */
  function liquidos() { return (D.productos || []).filter(function (p) { return p.tipo !== 'glp'; }); }
  function glps() { return (D.productos || []).filter(function (p) { return p.tipo === 'glp'; }); }

  function renderLiq() {
    var sel = liquidos().filter(function (p) { return state.sel.has(p.id); })
      .map(function (p) { return seriesPrice(p.id); }).filter(Boolean);
    var oil = state.oil === 'none' ? null : seriesOil(state.oil);
    var av = el('#aviso-vista');
    var msgBase = '';
    if (state.oil !== 'none' && !oil) msgBase = 'No hay datos de ' + OIL_NOMBRE[state.oil] + ' en data.json. ';
    if (state.vista === 'dual' && oil) {
      av.textContent = msgBase + 'Doble eje: la escala izquierda (Gs por litro) y la derecha (US$ por galón) son independientes. No compares alturas entre combustibles y petróleo.';
    } else {
      av.textContent = msgBase;
    }
    drawChart('chart-liq', {
      series: sel, oil: oil, view: state.vista, rango: state.rango, leyendaId: 'leyenda-liq',
      vacio: 'Elegí al menos un producto para ver el gráfico.',
      aria: 'Precios de combustibles de Petropar y petróleo internacional, serie histórica',
      onInfo: function (i) {
        if (state.vista === 'index') {
          av.textContent = msgBase + (i.base
            ? 'Índice base 100: en ' + fmtD(i.base) + ' (primera fecha del período con todas las series visibles) cada serie vale 100.'
            : 'Índice base 100: no hay series con datos en este período.');
        }
      }
    });
  }
  function renderGlp() {
    var sel = glps().map(function (p) { return seriesPrice(p.id); }).filter(Boolean);
    drawChart('chart-glp', {
      series: sel, oil: null, view: 'dual', rango: 'all', leyendaId: 'leyenda-glp', altura: undefined,
      xDesdeDatos: true, sinPromos: true,
      vacio: 'Sin datos todavía. El GLP (Ñande Gas) entra con la primera captura del scraper.',
      ejeL: 'Gs por kg / por litro',
      unidadTxt: function (s) { return PRODS[s.id].meta.unidad === 'kg' ? 'por kg' : 'por litro'; },
      aria: 'Precios del GLP Ñande Gas'
    });
    if (!sel.length) { var lg = el('#leyenda-glp'); if (lg) lg.innerHTML = ''; }
  }
  function render() { if (!D) return; if (state.tab === 'liq') renderLiq(); else renderGlp(); }

  /* ---------- tabla y eventos ---------- */
  function renderTabla() {
    var h = '<table><thead><tr><th>Producto</th><th>Precio</th><th>Vigente desde</th><th>Tipo de precio</th><th>Estado</th><th>Fecha</th><th>Fuente</th></tr></thead><tbody>';
    (D.productos || []).forEach(function (m) {
      var p = PRODS[m.id], r = p.rows[p.rows.length - 1];
      var sw = '<span class="sw" style="border-color:' + cvar(m.id) + '"></span> ';
      if (!r) {
        h += '<tr><td class="prod" data-l="Producto">' + sw + esc(m.nombre) + '</td><td colspan="6" data-l="Estado">Sin datos todavía</td></tr>';
        return;
      }
      var uv = (r.urls || []).filter(urlOk);
      var us = uv.map(function (u, i) {
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">enlace' + (uv.length > 1 ? ' ' + (i + 1) : '') + '</a>';
      }).join(' · ');
      var futuro = r.fecha > iso(new Date());
      var corte = m.datos_hasta && r.fecha <= m.datos_hasta;
      h += '<tr><td class="prod" data-l="Producto">' + sw + esc(m.nombre) + '</td>'
        + '<td class="num" data-l="Precio">' + gs(r.precio) + (m.unidad === 'kg' ? ' / kg' : ' / litro') + '</td>'
        + '<td class="num" data-l="Vigente desde">' + (futuro ? 'Rige desde ' : '') + fmtIso(r.fecha) + (futuro ? '<br><small>todavía no vigente</small>' : '') + (corte ? '<br><small>último dato; sin precio desde ' + fmtIso(m.datos_hasta) + '</small>' : '') + '</td>'
        + '<td data-l="Tipo de precio">' + esc(TIPO_TXT[r.tipo_precio] || r.tipo_precio) + '</td>'
        + '<td data-l="Estado">' + esc(ESTADO_TXT[r.estado] || r.estado) + (r.firme === false ? ' (no firme)' : '') + '</td>'
        + '<td data-l="Fecha">' + esc(FECHA_ESTADO_TXT[r.fecha_estado] || r.fecha_estado) + '</td>'
        + '<td data-l="Fuente">' + esc(r.fuente || '') + (us ? ' ' + us : '') + '</td></tr>';
    });
    h += '</tbody></table>';
    el('#tabla-vigentes').innerHTML = h;
  }
  function renderEventos() {
    var evs = D.eventos || [];
    if (!evs.length) { el('#lista-eventos').innerHTML = '<p>No hay eventos cargados.</p>'; return; }
    el('#lista-eventos').innerHTML = '<ul class="ev">' + evs.map(function (e) {
      return '<li><span class="tag">' + (e.tipo === 'promo' ? 'Promoción' : 'Hito') + '</span> ' + esc(e.etiqueta) + '<br>'
        + fmtIso(e.fecha) + (e.fecha_fin ? ' al ' + fmtIso(e.fecha_fin) : '')
        + (e.fuente ? ' · ' + esc(e.fuente) : '')
        + (urlOk(e.url) ? ' · <a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">enlace</a>' : '')
        + (e.nota ? '<br><small>' + esc(e.nota) + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- controles ---------- */
  function buildChips() {
    var box = document.createElement('div'); box.className = 'chips-box';
    liquidos().forEach(function (p) {
      var lb = document.createElement('label'); lb.className = 'chip';
      lb.innerHTML = '<input type="checkbox" value="' + esc(p.id) + '" checked><span class="chip-in"><span class="sw" style="border-color:' + cvar(p.id) + '"></span>' + esc(p.nombre) + '</span>';
      box.appendChild(lb);
    });
    el('#ctl-prod').appendChild(box);
    box.addEventListener('change', function (ev) {
      var i = ev.target;
      if (i.checked) state.sel.add(i.value); else state.sel.delete(i.value);
      render();
    });
  }
  function wireControls() {
    [['vista', 'vista'], ['oil', 'oil'], ['rango', 'rango']].forEach(function (c) {
      document.querySelectorAll('input[name=' + c[0] + ']').forEach(function (i) {
        i.addEventListener('change', function () { if (i.checked) { state[c[1]] = i.value; render(); } });
      });
    });
    [['liq', 'glp'], ['glp', 'liq']].forEach(function (pair) {
      el('#tab-' + pair[0]).addEventListener('click', function () {
        state.tab = pair[0];
        el('#tab-' + pair[0]).classList.add('on'); el('#tab-' + pair[0]).setAttribute('aria-selected', 'true');
        el('#tab-' + pair[1]).classList.remove('on'); el('#tab-' + pair[1]).setAttribute('aria-selected', 'false');
        el('#panel-' + pair[0]).hidden = false; el('#panel-' + pair[1]).hidden = true;
        render();
      });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') Object.keys(charts).forEach(function (k) { if (charts[k].esc) charts[k].esc(); });
    });
    var raf = 0, lastW = 0;
    var ro = new ResizeObserver(function () {
      var w = el('#panel-liq').hidden ? el('#chart-glp').clientWidth : el('#chart-liq').clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(render);
    });
    ro.observe(document.body);
  }

  function textos() {
    var u = D.ultimo_dato || {};
    var f = 'Datos al ' + fmtIso(u.petropar || '') + ' (precios Petropar)';
    var o = [];
    if (u.wti) o.push('WTI al ' + fmtIso(u.wti));
    if (u.ulsd) o.push('ULSD al ' + fmtIso(u.ulsd));
    el('#frescura').textContent = f + (o.length ? ' · ' + o.join(', ') : '') + '.';
    if (D.generado) el('#generado').textContent = 'Sitio generado el ' + fmtIso(String(D.generado).slice(0, 10)) + '.';
    var hu = (D.productos || []).filter(function (p) { return p.datos_hasta; }).map(function (p) {
      // si el scraper ya retomó la serie, el hueco tiene fin
      var sig = ((PRODS[p.id] || {}).rows || []).filter(function (r) { return r.fecha > p.datos_hasta; })
        .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })[0];
      return p.nombre + (sig
        ? ': sin dato entre el ' + fmtIso(p.datos_hasta) + ' y el ' + fmtIso(sig.fecha) + '.'
        : ': sin dato desde el ' + fmtIso(p.datos_hasta) + '.');
    });
    el('#nota-huecos').textContent = hu.length ? 'Hoy: ' + hu.join(' ') : 'Hoy no hay huecos conocidos.';
  }

  /* ---------- arranque ---------- */
  function init(data) {
    prepare(data);
    state.sel = new Set(liquidos().map(function (p) { return p.id; }));
    textos(); buildChips(); renderTabla(); renderEventos(); wireControls();
    /* Parámetros de URL (para compartir o capturar): ?rango=all|10|5|2 y ?pestana=glp */
    try {
      var qp = new URLSearchParams(location.search), rg = qp.get('rango');
      if (rg && ['all', '10', '5', '2'].indexOf(rg) >= 0) {
        state.rango = rg;
        var ri = document.querySelector('input[name=rango][value="' + rg + '"]'); if (ri) ri.checked = true;
      }
      if (qp.get('pestana') === 'glp') { el('#tab-glp').click(); return; }
    } catch (e) { /* sin parámetros */ }
    render();
  }

  initTema();
  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) {
      el('#frescura').textContent = 'No se pudieron cargar los datos (' + e.message + '). Probá recargar la página.';
      if (window.console) console.error(e);
    });
})();
