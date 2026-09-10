/**
 * Підбір донорів ГП.
 *
 * Нічого з наявних скриптів не чіпає: не визначає onOpen, не змінює інші листи.
 * Меню створюється власним інстальованим тригером (GP_install).
 *
 * Як працює: стаєш на рядок проєкту → «Підбір ГП» → у файлі ТЗ замовника
 * (посилання з колонки F цього ж рядка) створюється/оновлюється лист «Донори».
 */

// ID таблиці-бази донорів — підставити свій
var GP_BASE_ID    = 'PUT_DONOR_BASE_SPREADSHEET_ID_HERE';
var GP_BASE_SHEET = 'Топ (Робоч)';
var GP_OUT_SHEET  = 'Донори';

var GP_DR_MIN         = 10;
var GP_TRAFFIC_MIN    = 100;
var GP_TRAFFIC_MIN_EN = 50;   // для англомовних донорів межа нижча

// Колонки бази донорів (нумерація з 0)
var B_BLOCK = 0, B_DOMAIN = 1, B_LANG = 2, B_DR = 3, B_TRAFFIC = 4,
    B_GEO = 5, B_REFDOM = 6, B_CHECKED = 7, B_LOGIN = 11, B_PASS = 12;

// Колонки листа проєктів (нумерація з 1)
var P_PROJECT = 3, P_COUNT = 4, P_LANG = 5, P_TZ = 6, P_PUBLIC = 8, P_SPACE = 19;

// Що проставляємо в рядок проєкту після вдалого підбору
var GP_SET_PUBLIC = 'Погоджено донорів';
var GP_SET_SPACE  = 'на тул';

// Регіон визначається за ГЕО (стовпець «Гео трафіку»), а не за блоком бази.
// Блоки в базі заповнені непослідовно: єдиний nz-донор лежить у «Бразилії»,
// ru і vn — в «Арабських», kr — в «Америці». ГЕО — надійніший сигнал.
var GP_REGION_GEO = {
  'Європа': 'al am at az ba be bg by ch cy cz de dk ee es fi fr gb ge gr hr hu ie ' +
            'is it lt lu lv md me mk mt nl no pl pt ro rs ru se si sk tr ua uk eu',
  'Америка': 'us ca',
  'Океанія': 'au nz fj pg',
  'ЛатАм': 'mx ar cl co pe ve ec uy py bo cr pa do gt hn sv ni cu pr tt jm',
  'Бразилія': 'br',
  'Індія': 'in pk bd lk np bt',
  'Азія': 'th sg my id ph vn jp cn kr hk tw kh la mm mn kz uz kg tj',
  'Арабські': 'ae sa qa kw bh om jo lb ps sy iq eg ma dz tn ly ye il',
  'Африка': 'za ng ke gh cd ao tz ug et ci sn cm zm zw'
};

// Обернена мапа: код країни → регіон
var GP_GEO_REGION = (function () {
  var map = {};
  for (var region in GP_REGION_GEO) {
    var codes = GP_REGION_GEO[region].split(' ');
    for (var i = 0; i < codes.length; i++) map[codes[i]] = region;
  }
  return map;
})();

// Домашній регіон за мовою проєкту — запасний варіант, коли ГЕО з назви не вийняли.
// English сюди не входить: англійська про регіон нічого не каже.
var GP_LANG_REGION = {
  'Spanish': 'ЛатАм', 'Portuguese': 'Бразилія',
  'Italian': 'Європа', 'French': 'Європа', 'German': 'Європа', 'Dutch': 'Європа',
  'Polish': 'Європа', 'Romanian': 'Європа', 'Hungarian': 'Європа',
  'Bulgarian': 'Європа', 'Greek': 'Європа', 'Swedish': 'Європа',
  'Danish': 'Європа', 'Norwegian': 'Європа', 'Finnish': 'Європа',
  'Lithuanian': 'Європа', 'Latvian': 'Європа', 'Estonian': 'Європа',
  'Czech': 'Європа', 'Slovak': 'Європа', 'Slovenian': 'Європа',
  'Croatian': 'Європа', 'Serbian': 'Європа', 'Ukrainian': 'Європа',
  'Turkish': 'Європа', 'Georgian': 'Європа', 'Russian': 'Європа',
  'Thai': 'Азія', 'Vietnamese': 'Азія', 'Indonesian': 'Азія',
  'Japanese': 'Азія', 'Chinese': 'Азія', 'Korean': 'Азія',
  'Hindi': 'Індія', 'Arabic': 'Арабські'
};

// Англомовний проєкт без ГЕО в назві («Aviator», «4rabet in») — домашній регіон США.
var GP_REGION_DEFAULT_EN = 'Америка';

// Країни 2-го і 3-го світу. Це єдине, що досі береться з БЛОКА, а не з ГЕО —
// бо в базі це саме позначка блоку. У звичайні черги не йдуть НІКОЛИ.
// Потрапити в підбір можуть тільки через мову/ГЕО проєкту (черги native).
var GP_TIER_BLOCKS = ['Тір 2', 'Тір 3'];

// Які регіони взагалі допустимі для проєкту з таким домашнім регіоном.
// Усе, чого тут немає, у звичайні черги не потрапляє.
var GP_REGION_ALLOW = {
  'Європа':   ['Європа', 'Америка'],
  'Америка':  ['Америка', 'Європа'],
  'Океанія':  ['Океанія', 'Америка', 'Європа'],
  'Азія':     ['Азія', 'Америка'],
  'Індія':    ['Індія', 'Азія', 'Америка'],
  'Бразилія': ['Бразилія', 'ЛатАм', 'Америка', 'Європа'],
  'ЛатАм':    ['ЛатАм', 'Бразилія', 'Америка', 'Європа'],
  'Арабські': ['Арабські', 'Європа', 'Америка'],
  'Африка':   ['Африка', 'Європа', 'Америка']
};


/** Запустити ОДИН раз із редактора: створює меню «Підбір ГП» угорі таблиці. */
function GP_install() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'GP_showMenu' || fn === 'GP_onOpen_') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('GP_showMenu')
    .forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  Logger.log('Тригер меню створено. Перезавантажте таблицю — зʼявиться меню «Підбір ГП».');
}


/** Окреме меню — навмисно не onOpen, щоб не конфліктувати з наявними скриптами. */
function GP_showMenu() {
  SpreadsheetApp.getUi().createMenu('Підбір ГП')
    .addItem('Підібрати донорів для активного рядка', 'pickDonorsGP')
    .addToUi();
}


function pickDonorsGP() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var row = sheet.getActiveRange().getRow();

  var lang = String(sheet.getRange(row, P_LANG).getValue()).trim();
  if (!lang) {
    GP_say_(ss, 'У стовпці E цього рядка немає мови.\n' +
      'Станьте на рядок проєкту й запустіть підбір ще раз.');
    return;
  }

  var tzUrl = GP_cellUrl_(sheet.getRange(row, P_TZ));
  if (!tzUrl) {
    GP_say_(ss, 'У стовпці F цього рядка немає посилання на ТЗ замовника.\n' +
      'Лист «Донори» створюється саме в тому файлі.');
    return;
  }

  var target;
  try {
    target = SpreadsheetApp.openById(GP_idFromUrl_(tzUrl));
  } catch (e) {
    GP_say_(ss, 'Не вдалося відкрити файл ТЗ за посиланням із колонки F.\n' +
      'Перевірте, чи є у вас доступ до нього.\n\n' + tzUrl);
    return;
  }

  var project = String(sheet.getRange(row, P_PROJECT).getValue()).trim();
  var need = Number(sheet.getRange(row, P_COUNT).getValue()) || 0;
  var geo = GP_detectGeo_(project);
  var region = GP_region_(lang, geo);

  var donors = GP_loadBase_();
  var queues = GP_buildQueues_(donors, lang, geo, region);

  var picked = [], taken = {};
  for (var q = 0; q < queues.length; q++) {
    var group = queues[q].list;
    group.sort(function (a, b) { return b.traffic - a.traffic; });
    for (var i = 0; i < group.length; i++) {
      var d = group[i];
      if (taken[d.domain]) continue;
      if (!queues[q].native && !GP_passes_(d)) continue;
      taken[d.domain] = true;
      picked.push({ stage: queues[q].name, d: d, weak: !GP_passes_(d) });
    }
  }

  GP_writeSheet_(target, picked, project, lang, geo, region, need, donors.length);

  sheet.getRange(row, P_PUBLIC).setValue(GP_SET_PUBLIC);
  sheet.getRange(row, P_SPACE).setValue(GP_SET_SPACE);

  GP_say_(ss,
    'Готово.\n\nПроєкт: ' + (project || '—') +
    '\nМова: ' + lang + '   ГЕО: ' + (geo ? geo.toUpperCase() : 'не визначено') +
    '\nРегіон: ' + (region || 'не визначено — блоки не фільтрувалися') +
    '\nПотреба по ТЗ: ' + (need || '—') +
    '\nПідібрано донорів: ' + picked.length +
    '\n\nЛист «' + GP_OUT_SHEET + '» — у файлі ТЗ:\n' + target.getUrl());
}


/** З редактора getUi() недоступний — тоді пишемо в лог. */
function GP_say_(ss, msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    ss.toast(msg, 'Підбір ГП', 30);
    Logger.log(msg);
  }
}


/** URL із клітинки: гіперпосилання, =HYPERLINK() або просто текст. */
function GP_cellUrl_(range) {
  var rich = range.getRichTextValue();
  if (rich) {
    if (rich.getLinkUrl()) return rich.getLinkUrl();
    var runs = rich.getRuns();
    for (var i = 0; i < runs.length; i++) {
      if (runs[i].getLinkUrl()) return runs[i].getLinkUrl();
    }
  }
  var formula = String(range.getFormula() || '');
  var m = formula.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
  if (m) return m[1];
  var text = String(range.getValue() || '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
}


function GP_idFromUrl_(url) {
  var m = String(url).match(/\/d\/([a-zA-Z0-9\-_]+)/);
  if (!m) throw new Error('У посиланні немає ID таблиці: ' + url);
  return m[1];
}


/** ГЕО з назви проєкту: «Non Aams IT» → it. Шукає дволітерний код окремим словом. */
function GP_detectGeo_(project) {
  if (!project) return '';
  var words = project.split(/[\s\-_,()\/]+/);
  for (var i = words.length - 1; i >= 0; i--) {
    var w = words[i];
    if (/^[A-Za-z]{2}$/.test(w) && w === w.toUpperCase()) {
      var code = w.toLowerCase();
      if (code === 'id' || code === 'io') continue; // «Pay ID» — це не гео
      return code;
    }
  }
  return '';
}


/**
 * Домашній регіон проєкту. ГЕО з назви має пріоритет над мовою:
 * «Online Casinos NZ» — це Океанія, хоч мова й English.
 * Мова — лише запасний варіант, коли ГЕО з назви не вийняли.
 */
function GP_region_(lang, geo) {
  return GP_GEO_REGION[geo] || GP_LANG_REGION[lang] ||
         (lang === 'English' ? GP_REGION_DEFAULT_EN : '');
}


function GP_loadBase_() {
  var base = SpreadsheetApp.openById(GP_BASE_ID);
  var sh = base.getSheetByName(GP_BASE_SHEET);
  if (!sh) {
    // у різних скриптах лист пишуть то «Топ (Робоч)», то «ТОП (Робоч)»
    var all = base.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getName().toLowerCase() === GP_BASE_SHEET.toLowerCase()) { sh = all[i]; break; }
    }
  }
  if (!sh) throw new Error('Не знайдено лист «' + GP_BASE_SHEET + '» у базі донорів.');

  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var domain = String(r[B_DOMAIN] || '').trim().toLowerCase();
    if (!domain) continue;
    out.push({
      block:   String(r[B_BLOCK] || '').trim(),
      domain:  domain,
      lang:    String(r[B_LANG] || '').trim(),
      dr:      GP_toInt_(r[B_DR]),
      traffic: GP_toInt_(r[B_TRAFFIC]),
      geoRaw:  String(r[B_GEO] || '').trim(),
      geo:     GP_geoCode_(r[B_GEO]),
      refdom:  r[B_REFDOM],
      checked: r[B_CHECKED],
      login:   r[B_LOGIN],
      pass:    r[B_PASS]
    });
  }
  return out;
}


function GP_toInt_(v) {
  var n = parseInt(String(v).replace(/[^\d\-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}


/** «(au, 402)» → au */
function GP_geoCode_(v) {
  var m = String(v || '').match(/\(?\s*([A-Za-z]{2})\s*,/);
  return m ? m[1].toLowerCase() : '';
}


function GP_passes_(d) {
  if (d.dr < GP_DR_MIN) return false;
  var floor = (d.lang === 'English') ? GP_TRAFFIC_MIN_EN : GP_TRAFFIC_MIN;
  return d.traffic >= floor;
}


/**
 * Черги підбору.
 *   1. Регіональні — мова проєкту + ГЕО проєкту   уся база, без порогів
 *   2. Уся мова проєкту                           уся база, без порогів
 *   3. Увесь домашній регіон (напр. Європа)       pool + пороги
 *   4. Англомовні                                 pool + пороги
 *
 * Для англомовних проєктів черг дві: спершу домашній регіон за ГЕО
 * (NZ → «Океанія»), потім решта англомовних із дозволених регіонів.
 *
 * pool = база мінус Тір 2 / Тір 3 і мінус донори, чиє ГЕО не належить регіонам,
 * доречним для проєкту (до Італії не підходять ні Індія, ні Азія).
 * Тір 2 / Тір 3 можуть зайти тільки чергами 1–2, тобто коли їх вимагає
 * сама мова або ГЕО проєкту.
 */
function GP_buildQueues_(donors, lang, geo, region) {
  var allow = GP_REGION_ALLOW[region] || null;
  // Регіон донора — за його ГЕО, а не за блоком бази
  function donorRegion(d) { return GP_GEO_REGION[d.geo] || ''; }
  // Без розпізнаного регіону все одно відсікаємо Тір 2 / Тір 3
  var pool = donors.filter(function (d) {
    if (GP_TIER_BLOCKS.indexOf(d.block) !== -1) return false;
    return allow ? allow.indexOf(donorRegion(d)) !== -1 : true;
  });

  var used = {};
  var queues = [];

  // native = черга рідною мовою проєкту. Такі донори беруться з УСІЄЇ бази:
  // ні фільтр блоків, ні пороги DR/трафіку на них не діють — сама мова вже
  // гарантує влучання в регіон, у якому б блоці донор не був записаний.
  function take(name, isNative, filterFn) {
    var src = isNative ? donors : pool;
    var list = [];
    for (var i = 0; i < src.length; i++) {
      if (used[src[i].domain]) continue;
      if (filterFn(src[i])) { list.push(src[i]); used[src[i].domain] = true; }
    }
    if (list.length) queues.push({ name: name, native: isNative, list: list });
  }

  if (geo) {
    take('Регіональні — ' + lang + ' + ' + geo.toUpperCase(), true, function (d) {
      return d.lang === lang && d.geo === geo;
    });
  }

  if (lang !== 'English') {
    take('Уся мова — ' + lang, true, function (d) { return d.lang === lang; });
    if (region && region !== 'Америка') {
      take('Увесь регіон — ' + region, false, function (d) {
        return donorRegion(d) === region;
      });
    }
  } else if (region && region !== 'Америка') {
    // Англомовний проєкт: спершу весь домашній регіон за ГЕО, потім решта англомовних
    take('Англомовні — регіон ' + region, false, function (d) {
      return d.lang === 'English' && donorRegion(d) === region;
    });
  }

  take('Англомовні' + (allow ? ' — ' + allow.join(', ') : ''), false, function (d) {
    return d.lang === 'English';
  });

  // Нумеруємо вже після збірки, щоб порожні черги не залишали дірок у нумерації
  for (var k = 0; k < queues.length; k++) {
    queues[k].name = (k + 1) + '. ' + queues[k].name;
  }

  return queues;
}


function GP_writeSheet_(ss, picked, project, lang, geo, region, need, baseCount) {
  var sh = ss.getSheetByName(GP_OUT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(GP_OUT_SHEET);
  } else {
    sh.clear();
    sh.clearConditionalFormatRules();
  }

  var allow = GP_REGION_ALLOW[region];

  sh.getRange('A1').setValue('Підбір донорів ГП — ' + (project || '(без назви)'))
    .setFontWeight('bold').setFontSize(13);
  sh.getRange('A2').setValue(
    'Мова: ' + lang +
    '   |   ГЕО: ' + (geo ? geo.toUpperCase() : 'не визначено з назви проєкту') +
    '   |   регіон: ' + (region || 'не визначено') +
    '   |   регіони: ' + (allow ? allow.join(', ') : 'усі') +
    '   |   потреба по ТЗ: ' + (need || '—') +
    '   |   підібрано: ' + picked.length + ' із бази ' + baseCount +
    '   |   DR від ' + GP_DR_MIN + ', трафік від ' + GP_TRAFFIC_MIN +
    ' (' + GP_TRAFFIC_MIN_EN + ' для English)' +
    '   |   жовтим — взяті по мові/ГЕО попри пороги' +
    '   |   оновлено ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm')
  ).setFontStyle('italic').setFontColor('#666666');

  var headers = ['Черга', 'Блок', 'Домен', 'Мова', 'DR', 'Traffic', 'Гео трафіку',
                 'Ref. domains', 'Дата чека', 'Логін', 'Пароль'];
  sh.getRange(4, 1, 1, headers.length).setValues([headers])
    .setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');

  if (!picked.length) {
    sh.getRange('A5').setValue('Донорів за цими умовами не знайдено.');
    sh.setFrozenRows(4);
    return;
  }

  var rows = picked.map(function (p) {
    var d = p.d;
    return [p.stage, d.block, d.domain, d.lang, d.dr, d.traffic, d.geoRaw,
            d.refdom, d.checked, d.login, d.pass];
  });
  sh.getRange(5, 1, rows.length, headers.length).setValues(rows);

  // Жовтим — ті, кого взяли всупереч порогам (тільки через мову/ГЕО проєкту)
  var bgs = picked.map(function (p) {
    var color = p.weak ? '#FFEB9C' : '#FFFFFF';
    var line = [];
    for (var c = 0; c < headers.length; c++) line.push(color);
    return line;
  });
  sh.getRange(5, 1, rows.length, headers.length).setBackgrounds(bgs);

  sh.getRange(4, 1, rows.length + 1, headers.length)
    .setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);

  var widths = [230, 110, 260, 90, 55, 80, 120, 110, 100, 180, 200];
  for (var i = 0; i < widths.length; i++) sh.setColumnWidth(i + 1, widths[i]);
  sh.setFrozenRows(4);
}
